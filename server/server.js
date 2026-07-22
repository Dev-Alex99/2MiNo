const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const {
  rooms,
  getOnlineCount,
  incOnlineCount,
  decOnlineCount,
  findMe,
  removeSpectatorEverywhere,
  broadcastLobby,
  broadcastGameState,
  broadcastStats,
  destroyRoom
} = require('./roomManager');

const registerRoomHandlers = require('./handlers/roomHandler');
const registerGameHandlers = require('./handlers/gameHandler');
const { registerVoiceHandlers, leaveVoice } = require('./handlers/voiceHandler');

const app = express();
app.use(cors());

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

app.get('/ice-config', async (req, res) => {
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

app.get('/health', (req, res) => {
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
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  perMessageDeflate: false,
  maxHttpBufferSize: 1e5
});

io.on('connection', (socket) => {
  console.log(`Nuevo cliente conectado: ${socket.id}`);
  incOnlineCount();
  broadcastStats(io);

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

    decOnlineCount();
    broadcastStats(io);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
