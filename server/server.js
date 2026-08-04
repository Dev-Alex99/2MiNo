// Cargar variables de entorno ANTES que cualquier otro require (db.js lee
// process.env.DATABASE_URL al cargarse). Se apunta explícitamente a server/.env
// para que funcione arranques node desde donde arranques.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const {
  corsOptions,
  securityHeaders,
  httpRateLimit,
  installSocketRateLimit,
  installConnectionLimit,
  allowedOrigins,
  MAX_SOCKETS_PER_IP
} = require('./security');

const {
  rooms,
  getOnlineCount,
  incOnlineCount,
  decOnlineCount,
  findMe,
  forgetSocket,
  removeSpectatorEverywhere,
  broadcastLobby,
  broadcastGameState,
  broadcastStats,
  destroyRoom
} = require('./roomManager');

const registerRoomHandlers = require('./handlers/roomHandler');
const registerGameHandlers = require('./handlers/gameHandler');
const { registerVoiceHandlers, leaveVoice } = require('./handlers/voiceHandler');
const identity = require('./identity');
require('./games/TicTacToeGame');
require('./games/UnoGame');

// Red de seguridad del proceso. Socket.IO NO captura las excepciones de sus
// manejadores: una sola línea que lance en cualquiera de los ~53 eventos (o en
// un timer de sala) llega hasta aquí. Sin estas guardas, Node mata el proceso y
// se caen TODAS las partidas, torneos y llamadas de voz en curso — un cliente
// anónimo podía provocarlo con un único evento.
//
// Se registra y se sigue sirviendo: el estado de una sala puede quedar raro,
// pero tirar a todos los jugadores del servidor es estrictamente peor. Los
// fallos quedan en el log para poder corregir la causa.
process.on('uncaughtException', (err) => {
  console.error('[fatal] Excepción no capturada (el servidor sigue en pie):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Promesa rechazada sin manejar (el servidor sigue en pie):', reason);
});

const app = express();
app.set('trust proxy', 1); // detrás de Render/Vercel: usar X-Forwarded-For para el rate-limit por IP
app.use(securityHeaders);
app.use(cors(corsOptions));

const origins = allowedOrigins();
console.log(`[seguridad] CORS: ${origins ? origins.join(', ') : 'ABIERTO (*) — define CLIENT_ORIGINS en producción'}`);

// Configuración ICE para el chat de voz
let cfIceCache = null;
async function getCloudflareIceServers() {
  const keyId = process.env.CF_TURN_KEY_ID;
  const apiToken = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !apiToken) return null;
  if (cfIceCache && cfIceCache.expiresAt > Date.now()) return cfIceCache.iceServers;
  try {
    const ttl = 86400; // 24 h
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl })
      }
    );
    if (!r.ok) {
      console.warn('[ice] Cloudflare TURN respondió', r.status);
      return cfIceCache ? cfIceCache.iceServers : null;
    }
    const data = await r.json();
    const servers = Array.isArray(data.iceServers) ? data.iceServers : null;
    if (!servers) return null;
    cfIceCache = { iceServers: servers, expiresAt: Date.now() + (ttl - 4 * 3600) * 1000 };
    return servers;
  } catch (e) {
    console.warn('[ice] Cloudflare TURN error:', e.message);
    return cfIceCache ? cfIceCache.iceServers : null;
  }
}

// /ice-config golpea la API de Cloudflare TURN: limitar por IP para que no se
// use como amplificador ni agote la cuota.
app.get('/ice-config', httpRateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  const iceServers = [
    { urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun.cloudflare.com:3478'
    ] }
  ];

  let turnMode = 'none';
  const cf = await getCloudflareIceServers();
  if (cf) {
    iceServers.push(...cf);
    turnMode = 'cloudflare';
  } else if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
    turnMode = 'custom';
  } else {
    iceServers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    });
    turnMode = 'free-fallback';
  }

  res.set('Cache-Control', 'public, max-age=60');
  res.json({ iceServers, turnMode, turnConfigured: turnMode === 'cloudflare' || turnMode === 'custom' });
});

// /health expone memoria y nº de salas: útil para monitorizar, pero no hace
// falta que cualquiera lo consulte en bucle.
app.get('/health', httpRateLimit({ windowMs: 60000, max: 60 }), (req, res) => {
  const m = process.memoryUsage();
  res.json({
    ok: true,
    rooms: rooms.size,
    sockets: getOnlineCount(),
    rssMB: +(m.rss / 1048576).toFixed(1),
    heapMB: +(m.heapUsed / 1048576).toFixed(1)
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  perMessageDeflate: false,
  maxHttpBufferSize: 1e5
});

// Tope de sockets simultáneos por IP. El rate-limit por socket se evadía
// abriendo conexiones nuevas; esto pone techo a cuántas puede tener una IP.
installConnectionLimit(io);
console.log(`[seguridad] Máx. sockets simultáneos por IP: ${MAX_SOCKETS_PER_IP}`);

io.on('connection', (socket) => {
  console.log(`Nuevo cliente conectado: ${socket.id}`);
  incOnlineCount();
  broadcastStats(io);

  // Rate-limit por socket: corta el spam de eventos (crear salas, chat, señales)
  // antes de que lleguen a los handlers. Debe instalarse ANTES de registrarlos.
  installSocketRateLimit(socket);

  // Handshake de sesión: el cliente presenta su { playerId, token }.
  //  · Identidad libre  → la reclama y recibe su token.
  //  · Ya reclamada     → solo se vincula si el token es válido. El servidor NO
  //    emite token para una identidad ajena (eso era el oráculo de C-2).
  // Si no queda vinculado, `session` llega con authed:false y sin token, y las
  // operaciones sociales/económicas de ese socket no encontrarán identidad.
  socket.on('hello', (data) => {
    identity.beginHandshake(socket, data || {})
      .then((res) => socket.emit('session', {
        playerId: res.playerId,
        token: res.token,
        authed: res.authed,
        reason: res.reason
      }))
      .catch(() => socket.emit('session', { playerId: null, token: null, authed: false }));
  });

  // Registrar manejadores modularizados
  const { leaveVoice: leaveVoiceSelf } = registerVoiceHandlers(io, socket);
  registerRoomHandlers(io, socket, leaveVoiceSelf);
  registerGameHandlers(io, socket);

  // Evento de Desconexión
  socket.on('disconnect', () => {
    leaveVoice(io, socket, findMe(socket.id));
    console.log(`Cliente desconectado: ${socket.id}`);

    try { require('./tournamentManager').handleDisconnect(io, socket.id); } catch (e) { /* noop */ }
    try { require('./matchmaking').leaveQueue(socket.id); } catch (e) { /* noop */ }
    try {
      const { becameOffline, playerId } = require('./presence').unregister(socket.id);
      if (becameOffline) require('./friendService').notifyFriendsOfPresence(io, playerId);
    } catch (e) { /* noop */ }

    if (removeSpectatorEverywhere(socket.id)) broadcastLobby(io);

    for (const [roomId, game] of rooms.entries()) {
      const player = game.players.find(p => p.socketId === socket.id);
      if (player) {
        if (game.status === 'waiting') {
          game.removePlayer(socket.id);
          console.log(`Jugador ${player.name} abandonó la sala en espera ${roomId}`);

          if (!game.hasHumans()) {
            destroyRoom(io, roomId);
            console.log(`Sala sin humanos eliminada: ${roomId}`);
          } else {
            broadcastGameState(io, roomId);
          }
          broadcastLobby(io);
        } else {
          player.socketId = null;
          broadcastGameState(io, roomId);
          console.log(`Jugador ${player.name} se desconectó temporalmente de la sala activa ${roomId}`);

          // Las salas de torneo NO se destruyen por "todos offline": el reloj de
          // turno las termina y onMatchEnd avanza el cuadro (destruyéndolas). Si
          // las matáramos aquí, el torneo quedaría colgado sin ganador.
          const allOffline = !game.tournamentId && game.players.every(p => p.socketId === null);
          if (allOffline) {
            setTimeout(() => {
              const checkGame = rooms.get(roomId);
              if (checkGame && checkGame.players.every(p => p.socketId === null)) {
                destroyRoom(io, roomId);
                broadcastLobby(io);
                console.log(`Sala ${roomId} eliminada por inactividad prolongada (todos offline).`);
              }
            }, 120000);
          }
        }
        break;
      }
    }

    forgetSocket(socket.id); // el índice socketId→sala no debe crecer con muertos
    decOnlineCount();
    broadcastStats(io);
  });
});

const PORT = process.env.PORT || 3001;

// Un fallo al abrir el puerto (EADDRINUSE, EACCES) SÍ debe ser fatal: sin él no
// hay servicio y lo correcto es morir para que Render lo reinicie. La guarda de
// `uncaughtException` de arriba lo convertiría en un proceso zombi vivo pero sin
// escuchar, que es peor que caerse (los health checks lo darían por bueno).
server.on('error', (err) => {
  console.error(`[fatal] No se pudo abrir el puerto ${PORT}:`, err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
