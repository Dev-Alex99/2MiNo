const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const DominoGame = require('./gameLogic');
const { chooseMove, choosePower, pickBotName } = require('./botLogic');

const app = express();
app.use(cors());

// Configuración ICE para el chat de voz. Se sirve desde aquí (y no se incrusta
// en el cliente) para que las credenciales TURN vivan en variables de entorno
// y se puedan rotar sin volver a desplegar el front.
app.get('/ice-config', (req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];

  // TURN es opcional: sin él, el ~10-20% tras NAT simétrico no conectará.
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  // Cachear poco: las credenciales TURN suelen ser efímeras.
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ iceServers, turnConfigured: !!process.env.TURN_URL });
});

app.get('/health', (req, res) => {
  const m = process.memoryUsage();
  res.json({
    ok: true,
    rooms: rooms.size,
    sockets: onlineCount,
    rssMB: +(m.rss / 1048576).toFixed(1),
    heapMB: +(m.heapUsed / 1048576).toFixed(1)
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // En un entorno real se limitaría a los dominios del frontend
    methods: ['GET', 'POST']
  },
  // Memoria acotada por conexión (crítico en 512MB):
  // - perMessageDeflate apagado explícito: con compresión, cada socket reserva
  //   contextos zlib de ~300KB. En v4 ya viene apagado, pero lo fijamos para
  //   que un cambio de versión no lo reactive y nos tumbe la RAM.
  // - maxHttpBufferSize bajo: nuestros mensajes son diminutos (jugadas, señales
  //   de voz); 100KB sobra y acota memoria y superficie de abuso.
  perMessageDeflate: false,
  maxHttpBufferSize: 1e5
});

// Almacén de salas activas: roomId -> DominoGame
const rooms = new Map();

// Conectados. Contador propio en vez de io.engine.clientsCount: ese no ha
// decrementado todavía cuando se dispara el evento 'disconnect', y el número
// salía desfasado.
let onlineCount = 0;

// Temporizadores por sala: roomId -> handle
const turnTimers = new Map();   // reloj de turno
const effectTimers = new Map(); // caducidad de efectos (p. ej. Ojo Soplón)
const botTimers = new Map();    // "pensar" de los bots antes de jugar

// Segundos por turno. Configurable para ajustarlo sin tocar código.
const TURN_SECONDS = Math.max(5, Number(process.env.TURN_SECONDS) || 30);

// Genera un código de sala de 4 letras aleatorias
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  do {
    result = '';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(result));
  return result;
}

// Envía el estado del juego actualizado a todos los jugadores de la sala de forma privada
function broadcastGameState(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;

  // La parte común (config, tablero, efectos, reloj…) se calcula UNA vez y se
  // reutiliza; solo la lista de jugadores se filtra por destinatario. Evita
  // rehacer ~25 campos y el spread de activeEffects por cada jugador.
  const shared = game.getSharedState();

  game.players.forEach(player => {
    if (player.socketId) {
      io.to(player.socketId).emit('game_state', game.getGameStateForPlayer(player.id, shared));
    }
  });
}

// --- LISTA DE SALAS PÚBLICAS ---
// Se listan solo las que esperan jugadores y tienen sitio: una sala en curso o
// llena no sirve de nada en el lobby.
function publicRoomsList() {
  const list = [];
  for (const [roomId, game] of rooms.entries()) {
    if (!game.isPublic || game.status !== 'waiting' || game.players.length >= 4) continue;
    const host = game.players.find(p => !p.isBot);
    list.push({
      roomId,
      host: host ? host.name : '—',
      players: game.players.length,
      bots: game.players.filter(p => p.isBot).length,
      maxPip: game.maxPip,
      maxScore: game.maxScore,
      powersEnabled: game.powersEnabled,
      teamsEnabled: game.teamsEnabled,
      drawEnabled: game.drawEnabled
    });
  }
  // Primero las que están más cerca de arrancar.
  return list.sort((a, b) => b.players - a.players);
}

// Cifras para el lobby. online = sockets conectados (interpretación honesta de
// "en línea"); playing = humanos en salas que ya están jugando.
function lobbyStats() {
  let playing = 0;
  for (const game of rooms.values()) {
    if (game.status === 'playing') playing += game.players.filter(p => !p.isBot).length;
  }
  return {
    online: onlineCount,
    playing,
    openRooms: publicRoomsList().length
  };
}

function broadcastStats() {
  io.to('lobby').emit('lobby_stats', lobbyStats());
}

// Los clientes que están en el lobby se suscriben a una sala de Socket.IO
// llamada 'lobby' para recibir la lista en vivo, sin sondear.
function broadcastLobby() {
  io.to('lobby').emit('rooms_list', publicRoomsList());
  broadcastStats(); // una sala que cambia también cambia "salas abiertas"
}

function clearRoomTimers(roomId) {
  clearTimeout(turnTimers.get(roomId));
  clearTimeout(effectTimers.get(roomId));
  clearTimeout(botTimers.get(roomId));
  turnTimers.delete(roomId);
  effectTimers.delete(roomId);
  botTimers.delete(roomId);
}

// Arranca (o reinicia) el reloj del turno actual. Sin esto, un jugador que se
// desconecta o se distrae deja la mesa colgada indefinidamente.
function armTurnTimer(roomId) {
  const game = rooms.get(roomId);
  clearTimeout(turnTimers.get(roomId));
  turnTimers.delete(roomId);

  if (!game || game.status !== 'playing') {
    if (game) game.turnEndsAt = null;
    return;
  }

  game.turnEndsAt = Date.now() + game.turnDurationMs;

  turnTimers.set(roomId, setTimeout(() => {
    const current = rooms.get(roomId);
    if (!current || current.status !== 'playing') return;

    const result = current.forceTurn();
    if (result.action === 'none') return;

    const detail = result.drew > 0 ? ` (robó ${result.drew})` : '';
    const text = result.action === 'played'
      ? `⏱️ A ${result.playerName} se le acabó el tiempo: jugó automáticamente${detail}.`
      : `⏱️ A ${result.playerName} se le acabó el tiempo: pasó turno${detail}.`;

    io.to(roomId).emit('receive_quick_message', { playerName: 'SISTEMA', text, type: 'phrase' });
    io.to(roomId).emit('play_sound', { type: result.action === 'played' ? 'place' : 'pass' });

    advanceRoom(roomId);
    broadcastGameState(roomId);
  }, game.turnDurationMs));
}

// Reemite el estado cuando un efecto temporal caduca. El Ojo Soplón se calcula
// con Date.now() al pedir el estado, así que sin esto la mano revelada seguía
// en pantalla hasta que alguien moviera.
function scheduleEffectExpiry(roomId, ms) {
  clearTimeout(effectTimers.get(roomId));
  effectTimers.set(roomId, setTimeout(() => {
    effectTimers.delete(roomId);
    if (rooms.has(roomId)) broadcastGameState(roomId);
  }, ms + 250));
}

// Si el turno es de un bot, lo juega tras una pausa para que se lea como una
// decisión y no como un cálculo instantáneo.
function scheduleBotTurn(roomId) {
  const game = rooms.get(roomId);
  clearTimeout(botTimers.get(roomId));
  botTimers.delete(roomId);

  if (!game || game.status !== 'playing') return;

  const current = game.players[game.currentPlayerIndex];
  if (!current || !current.isBot) return;

  const thinkMs = 700 + Math.floor(Math.random() * 900);

  botTimers.set(roomId, setTimeout(() => {
    botTimers.delete(roomId);
    const g = rooms.get(roomId);
    if (!g || g.status !== 'playing') return;

    const bot = g.players[g.currentPlayerIndex];
    if (!bot || !bot.isBot) return;

    // 1. Un poder sin objetivo, de vez en cuando.
    const powerId = choosePower(g, bot.id);
    if (powerId) {
      const used = g.usePowerCard(bot.id, powerId, null, null);
      if (used.success) {
        io.to(roomId).emit('play_sound', { type: 'power' });
        io.to(roomId).emit('receive_quick_message', {
          playerName: 'SISTEMA',
          text: `🤖 ${bot.name} usó una carta de poder.`,
          type: 'phrase'
        });
      }
    }

    // 2. Su jugada. forceTurn() ya implementa "juega / roba / pasa" con las
    //    reglas completas; solo elegimos nosotros QUÉ ficha, según dificultad.
    const move = chooseMove(g, bot.id);
    if (move) {
      const played = g.playTile(bot.id, move.tileIndex, move.side);
      if (played.success) {
        io.to(roomId).emit('play_sound', { type: 'place', tile: g.lastPlay.tile });
      } else {
        g.forceTurn();
      }
    } else {
      const result = g.forceTurn();
      io.to(roomId).emit('play_sound', { type: result.action === 'played' ? 'place' : 'pass' });
    }

    advanceRoom(roomId);
    broadcastGameState(roomId);
  }, thinkMs));
}

// Todo lo que hay que rearmar tras cambiar el estado de una partida.
function advanceRoom(roomId) {
  armTurnTimer(roomId);
  scheduleBotTurn(roomId);
}

io.on('connection', (socket) => {
  console.log(`Nuevo cliente conectado: ${socket.id}`);
  onlineCount++;
  broadcastStats(); // subió el nº de conectados

  // Crea una sala y sienta al jugador. Compartido por create_room y quick_play.
  function createRoomFor(name, playerId, opts = {}) {
    // No confiamos en el cliente: normalizamos las opciones aquí.
    const safeMaxPip = opts.maxPip === 9 ? 9 : 6;
    const safePowers = opts.powersEnabled !== false;
    const safeTeams = opts.teamsEnabled === true;
    const safeDraw = opts.drawEnabled !== false;
    const safePublic = opts.isPublic !== false;
    const safeScore = [100, 150, 200, 300].includes(opts.maxScore) ? opts.maxScore : null;

    const roomId = generateRoomId();
    const game = new DominoGame(roomId, safeScore, {
      powersEnabled: safePowers,
      maxPip: safeMaxPip,
      teamsEnabled: safeTeams,
      drawEnabled: safeDraw,
      isPublic: safePublic
    });
    game.turnDurationMs = TURN_SECONDS * 1000;

    const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
    game.addPlayer(actualPlayerId, name, socket.id);

    rooms.set(roomId, game);
    socket.join(roomId);
    socket.leave('lobby'); // ya no está mirando la lista

    console.log(`Sala creada: ${roomId} por ${name} (doble ${safeMaxPip}, ${safePublic ? 'pública' : 'privada'}, ` +
      `poderes: ${safePowers ? 'sí' : 'no'}, ${safeTeams ? 'parejas' : 'individual'}, ${game.maxScore} pts)`);

    return { roomId, playerId: actualPlayerId };
  }

  // 1. Crear una sala
  socket.on('create_room', ({ name, playerId, ...opts }) => {
    if (!name) return socket.emit('error_msg', 'Nombre requerido');
    const created = createRoomFor(name, playerId, opts);
    socket.emit('room_created', created);
    broadcastGameState(created.roomId);
    broadcastLobby();
  });

  // 1.5 Lista de salas públicas en vivo
  socket.on('lobby_subscribe', () => {
    socket.join('lobby');
    socket.emit('rooms_list', publicRoomsList());
    socket.emit('lobby_stats', lobbyStats());
  });

  socket.on('lobby_unsubscribe', () => socket.leave('lobby'));

  // 1.6 Partida rápida: sienta al jugador en la sala pública más avanzada, y si
  // no hay ninguna, le crea una. Un botón y a jugar, sin códigos.
  socket.on('quick_play', ({ name, playerId }) => {
    if (!name) return socket.emit('error_msg', 'Nombre requerido');

    const candidate = publicRoomsList()[0]; // ya vienen ordenadas por ocupación
    if (candidate) {
      const game = rooms.get(candidate.roomId);
      const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
      if (game && game.addPlayer(actualPlayerId, name, socket.id)) {
        socket.join(candidate.roomId);
        socket.leave('lobby');
        socket.emit('room_joined', { roomId: candidate.roomId, playerId: actualPlayerId });
        broadcastGameState(candidate.roomId);
        broadcastLobby();
        console.log(`Partida rápida: ${name} -> sala ${candidate.roomId}`);
        return;
      }
    }

    // No había ninguna libre: se crea una pública y clásica (sin poderes).
    const created = createRoomFor(name, playerId, { isPublic: true, powersEnabled: false });
    socket.emit('room_created', created);
    broadcastGameState(created.roomId);
    broadcastLobby();
    console.log(`Partida rápida: ${name} abrió sala nueva ${created.roomId}`);
  });

  // 2. Unirse a una sala (soporta reconexión si se pasa el playerId existente)
  socket.on('join_room', ({ roomId, name, playerId }) => {
    roomId = roomId.trim().toUpperCase();
    const game = rooms.get(roomId);
    
    if (!game) {
      return socket.emit('error_msg', 'La sala no existe');
    }

    const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
    const existingPlayer = game.players.find(p => p.id === actualPlayerId);

    if (existingPlayer) {
      // Reconexión exitosa
      existingPlayer.socketId = socket.id;
      socket.join(roomId);
      socket.emit('room_joined', { roomId, playerId: actualPlayerId });
      broadcastGameState(roomId);
      broadcastLobby();
      console.log(`Jugador reconectado: ${existingPlayer.name} a sala ${roomId}`);
      return;
    }

    // Si es un nuevo jugador
    if (game.players.length >= 4) {
      return socket.emit('error_msg', 'La sala está llena (máximo 4 jugadores)');
    }
    if (game.status !== 'waiting') {
      return socket.emit('error_msg', 'La partida ya ha comenzado');
    }
    if (!name) {
      return socket.emit('error_msg', 'Nombre requerido');
    }

    game.addPlayer(actualPlayerId, name, socket.id);
    socket.join(roomId);
    
    socket.emit('room_joined', { roomId, playerId: actualPlayerId });
    broadcastGameState(roomId);
    broadcastLobby();
    console.log(`Jugador ${name} se unió a sala ${roomId}`);
  });

  // 2.5 Añadir / quitar bots (solo en la sala de espera)
  socket.on('add_bot', ({ roomId, difficulty }) => {
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error_msg', 'La sala no existe');
    if (game.status !== 'waiting') return socket.emit('error_msg', 'No se pueden añadir bots con la partida en curso');
    if (game.players.length >= 4) return socket.emit('error_msg', 'La sala está llena (máximo 4 jugadores)');

    const bot = game.addBot(pickBotName(game.players.map(p => p.name)), difficulty);
    if (!bot) return socket.emit('error_msg', 'No se pudo añadir el bot');

    broadcastGameState(roomId);
    broadcastLobby();
    console.log(`Bot ${bot.name} (${bot.difficulty}) añadido a sala ${roomId}`);

    // Un bot entra ya listo: puede completar el "todos listos".
    if (game.allReady()) {
      game.startNewGame();
      io.to(roomId).emit('game_started');
      broadcastLobby(); // al arrancar deja de listarse
      advanceRoom(roomId);
      broadcastGameState(roomId);
    }
  });

  // 2.6 Cambiar de sitio (así se elige compañero: el equipo sale del asiento)
  socket.on('swap_seats', ({ roomId, playerA, playerB }) => {
    const game = rooms.get(roomId);
    if (!game) return;
    if (game.status !== 'waiting') {
      return socket.emit('error_msg', 'No se pueden cambiar los sitios con la partida en curso');
    }
    if (!game.swapSeats(playerA, playerB)) {
      return socket.emit('error_msg', 'No se pudo cambiar de sitio');
    }

    // Cambiar de sitio cambia los equipos y el orden de turnos: que todo el
    // mundo reconfirme en vez de arrancar con una mesa que nadie aceptó.
    game.players.forEach(p => { if (!p.isBot) p.ready = false; });

    broadcastGameState(roomId);
  });

  // 2.8 Expulsar a un jugador. Solo el administrador de la sala.
  socket.on('kick_player', ({ targetId }) => {
    const ctx = findMe();
    if (!ctx) return;
    const { roomId, game, player } = ctx;

    if (game.hostId !== player.id) {
      return socket.emit('error_msg', 'Solo el administrador puede expulsar');
    }
    if (!targetId || targetId === player.id) {
      return socket.emit('error_msg', 'No puedes expulsarte a ti mismo');
    }
    const target = game.players.find(p => p.id === targetId);
    if (!target) return;

    const targetSocketId = target.socketId;

    if (target.isBot || game.status === 'waiting') {
      // En espera (o si es un bot) se libera la silla directamente.
      game.removePlayerById(targetId);
    } else {
      // En partida no se puede quitar la silla sin romper turnos/puntuación:
      // la hereda un bot, igual que cuando alguien abandona.
      target.isBot = true;
      target.difficulty = 'normal';
      target.socketId = null;
      target.ready = true;
      game.ensureHost();
    }

    // Sacar al expulsado de su socket y avisarle para que vuelva al lobby.
    if (targetSocketId && !target.isBot) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) targetSocket.leave(roomId);
    }
    if (targetSocketId) {
      io.to(targetSocketId).emit('kicked', { by: player.name });
    }

    io.to(roomId).emit('receive_quick_message', {
      playerName: 'SISTEMA',
      text: `👢 ${player.name} expulsó a ${target.name}.`,
      type: 'phrase'
    });

    if (!game.hasHumans()) {
      rooms.delete(roomId);
      clearRoomTimers(roomId);
      broadcastLobby();
      return;
    }

    advanceRoom(roomId);
    broadcastGameState(roomId);
    broadcastLobby();
    console.log(`${player.name} expulsó a ${target.name} de ${roomId}`);
  });

  socket.on('remove_bot', ({ roomId, botId }) => {
    const game = rooms.get(roomId);
    if (!game) return;
    if (game.status !== 'waiting') return socket.emit('error_msg', 'No se pueden quitar bots con la partida en curso');

    const target = game.players.find(p => p.id === botId);
    if (!target || !target.isBot) return socket.emit('error_msg', 'Ese jugador no es un bot');

    game.removePlayerById(botId);
    broadcastGameState(roomId);
    broadcastLobby();
  });

  // 2.7 Abandonar la sala de forma explícita.
  // Antes esto se simulaba desconectando el socket, y el servidor lo trataba
  // como una caída: la silla quedaba reservada esperando una reconexión que
  // nunca llegaba.
  socket.on('leave_room', () => {
    const ctx = findMe();
    if (!ctx) return;
    const { roomId, game, player } = ctx;

    leaveVoice(ctx);
    socket.leave(roomId);

    if (game.status === 'waiting') {
      game.removePlayerById(player.id);
    } else {
      // Partida en curso: no se puede quitar la silla sin romperle el juego a
      // los demás (turnos, equipos, puntuación). La hereda un bot con su misma
      // mano y su mismo sitio, y la partida sigue.
      player.isBot = true;
      player.difficulty = 'normal';
      player.socketId = null;
      player.ready = true;

      io.to(roomId).emit('receive_quick_message', {
        playerName: 'SISTEMA',
        text: `🤖 ${player.name} abandonó la partida. Un bot ocupa su sitio.`,
        type: 'phrase'
      });
      game.ensureHost(); // si el que se fue era el admin, lo hereda otro humano
    }

    if (!game.hasHumans()) {
      rooms.delete(roomId);
      clearRoomTimers(roomId);
      broadcastLobby();
      console.log(`Sala ${roomId} eliminada: se fue el último humano`);
      return;
    }

    advanceRoom(roomId); // por si ahora le toca mover al bot recién heredado
    broadcastGameState(roomId);
    broadcastLobby(); // ha quedado un sitio libre
    console.log(`${player.name} abandonó la sala ${roomId}`);
  });

  // 3. Cambiar estado de "Listo"
  socket.on('toggle_ready', ({ roomId, playerId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    game.toggleReady(socket.id);
    broadcastGameState(roomId);

    // Si todos están listos, iniciar la partida automáticamente
    if (game.allReady()) {
      game.startNewGame();
      io.to(roomId).emit('game_started');
      broadcastLobby(); // al arrancar deja de listarse
      advanceRoom(roomId);
      broadcastGameState(roomId);
      console.log(`Partida iniciada en sala ${roomId}`);
    }
  });

  // 4. Jugar una ficha
  socket.on('play_tile', ({ roomId, playerId, tileIndex, side }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.playTile(playerId, tileIndex, side);
    if (result.success) {
      // Notificar sonido de ficha colocada
      io.to(roomId).emit('play_sound', { type: 'place', tile: game.lastPlay.tile });
      advanceRoom(roomId);
      broadcastGameState(roomId);
    } else {
      socket.emit('error_msg', result.error);
    }
  });

  // 5. Robar una ficha del pozo
  socket.on('draw_tile', ({ roomId, playerId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.drawTile(playerId);
    if (result.success) {
      io.to(roomId).emit('play_sound', { type: 'draw' });
      advanceRoom(roomId); // robar no cede el turno: se da margen nuevo
      broadcastGameState(roomId);
    } else {
      socket.emit('error_msg', result.error);
    }
  });

  // 6. Pasar turno
  socket.on('pass_turn', ({ roomId, playerId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.passTurn(playerId);
    if (result.success) {
      io.to(roomId).emit('play_sound', { type: 'pass' });
      advanceRoom(roomId);
      broadcastGameState(roomId);
    } else {
      socket.emit('error_msg', result.error);
    }
  });

  // 6.5 Usar una carta de poder
  socket.on('use_power_card', ({ roomId, playerId, cardId, targetId, tileIndex }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const player = game.players.find(p => p.id === playerId);
    if (!player) return;

    const result = game.usePowerCard(playerId, cardId, targetId, tileIndex);
    if (result.success) {
      // Emitir sonido de poder activado a toda la sala
      io.to(roomId).emit('play_sound', { type: 'power' });

      // Preparar notificaciones de chat según el poder
      let messageText = '';
      const targetPlayer = targetId ? game.players.find(p => p.id === targetId) : null;

      if (result.shielded) {
        messageText = `¡${player.name} intentó lanzar un poder contra ${result.targetName}, pero fue bloqueado por su Escudo de Neón!`;
      } else {
        switch (cardId) {
          case 'double_shot':
            messageText = `¡${player.name} usó Doble Tiro! Jugará dos veces seguidas.`;
            break;
          case 'smuggle':
            messageText = `¡${player.name} le regaló una ficha a ${targetPlayer ? targetPlayer.name : 'un oponente'} mediante Contrabando!`;
            break;
          case 'spy_eye':
            messageText = `¡${player.name} usó El Ojo Soplón para espiar las fichas de ${targetPlayer ? targetPlayer.name : 'un oponente'}!`;
            break;
          case 'skip':
            messageText = `¡${player.name} usó Salto de Turno! Se saltó al siguiente jugador.`;
            break;
          case 'draw_penalty':
            messageText = `¡${player.name} penalizó a ${targetPlayer ? targetPlayer.name : 'un oponente'} obligándolo a robar del pozo!`;
            break;
          case 'reverse':
            messageText = `¡${player.name} invirtió el sentido del juego!`;
            break;
          case 'trade':
            messageText = `¡${player.name} cambió una ficha de su mano por una del pozo!`;
            break;
          case 'shield':
            messageText = `¡${player.name} activó su Escudo de Neón y es inmune a ataques!`;
            break;
          case 'freeze':
            const frozenSide = targetId === 'left' ? 'izquierdo' : 'derecho';
            messageText = `¡${player.name} congeló el extremo ${frozenSide} del tablero! Nadie más puede jugar ahí este turno.`;
            break;
          case 'destiny_steal':
            messageText = `¡${player.name} le robó una carta de poder a ${targetPlayer ? targetPlayer.name : 'un oponente'}!`;
            break;
          case 'mind_swap':
            messageText = `¡${player.name} usó Intercambio Mental e intercambió su mano completa con ${targetPlayer ? targetPlayer.name : 'un oponente'}!`;
            break;
          case 'tile_demolition':
            const demolishedSide = targetId === 'left' ? 'izquierdo' : 'derecho';
            messageText = `¡${player.name} usó Ficha Dinamita y destruyó la ficha del extremo ${demolishedSide}!`;
            break;
          case 'wildcard':
            messageText = `¡${player.name} usó una Ficha Comodín! Podrá colocar cualquier ficha en el tablero este turno.`;
            break;
          case 'boneyard_reset':
            messageText = `¡${player.name} usó Reinicio Estelar y cambió toda su mano por fichas del pozo!`;
            break;
          case 'magnetic_pull':
            messageText = `¡${player.name} usó Atracción Magnética sobre ${targetPlayer ? targetPlayer.name : 'un oponente'} obligándolo a robar del pozo!`;
            break;
          case 'russian_roulette':
            messageText = `¡${player.name} activó la Ruleta Rusa! Todos los jugadores pasan una ficha al de su derecha.`;
            break;
          default:
            messageText = `¡${player.name} usó una carta de poder!`;
        }
      }

      // Propagar mensaje al chat rápido para que aparezca como toast flotante
      io.to(roomId).emit('receive_quick_message', {
        playerName: 'SISTEMA',
        text: messageText,
        type: 'phrase'
      });

      // El Ojo Soplón revela por tiempo: hay que reemitir al caducar.
      if (cardId === 'spy_eye' && game.activeEffects.spyEyeEndTime) {
        scheduleEffectExpiry(roomId, game.activeEffects.spyEyeEndTime - Date.now());
      }

      advanceRoom(roomId);
      broadcastGameState(roomId);
    } else {
      socket.emit('error_msg', result.error);
    }
  });

  // 7. Siguiente ronda (cuando finaliza una)
  socket.on('next_round', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    if (game.status === 'round_ended') {
      game.startNewRound();
      io.to(roomId).emit('play_sound', { type: 'shuffle' });
      advanceRoom(roomId);
      broadcastGameState(roomId);
    }
  });

  // 8. Reiniciar juego (jugar de nuevo al finalizar la partida)
  socket.on('play_again', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    if (game.status === 'game_ended' || game.status === 'round_ended') {
      game.startNewGame();
      io.to(roomId).emit('play_sound', { type: 'shuffle' });
      advanceRoom(roomId);
      broadcastGameState(roomId);
    }
  });

  // 9. Mensajes rápidos y Emojis
  socket.on('send_quick_message', ({ roomId, playerId, text, type }) => {
    // type: 'phrase' o 'emoji'
    const game = rooms.get(roomId);
    if (!game) return;

    const player = game.players.find(p => p.id === playerId);
    if (!player) return;

    io.to(roomId).emit('receive_quick_message', {
      playerId,
      playerName: player.name,
      text,
      type
    });
  });

  // --- CHAT DE VOZ (WebRTC en malla) ---
  // El audio va peer-to-peer y NUNCA pasa por aquí: por el servidor solo viajan
  // ofertas, respuestas y candidatos ICE (unos pocos KB al conectar).

  function findMe() {
    for (const [roomId, game] of rooms.entries()) {
      const player = game.players.find(p => p.socketId === socket.id);
      if (player) return { roomId, game, player };
    }
    return null;
  }

  // Saca a un jugador de la voz y avisa al resto. Se usa al salir y al caerse.
  function leaveVoice(ctx) {
    if (!ctx || !ctx.player.inVoice) return;
    ctx.player.inVoice = false;
    ctx.player.camOn = false;
    socket.to(ctx.roomId).emit('voice_peer_left', { playerId: ctx.player.id });
    broadcastGameState(ctx.roomId);
  }

  // Estado de la cámara. Va por aquí y NO se deduce del track remoto:
  // replaceTrack(null) deja de enviar fotogramas pero el track del receptor NO
  // pasa a "muted", así que los demás verían el último fotograma congelado.
  // Al vivir en el estado del jugador, quien entre después también se entera.
  socket.on('voice_cam', ({ on }) => {
    const ctx = findMe();
    if (!ctx || !ctx.player.inVoice) return;
    ctx.player.camOn = !!on;
    broadcastGameState(ctx.roomId);
  });

  socket.on('voice_join', () => {
    const ctx = findMe();
    if (!ctx) return socket.emit('error_msg', 'No estás en ninguna sala');

    ctx.player.inVoice = true;
    ctx.player.camOn = false;

    // A quién debe llamar: los que ya estaban dentro y siguen conectados.
    const peers = ctx.game.players
      .filter(p => p.inVoice && p.socketId && p.id !== ctx.player.id)
      .map(p => ({ playerId: p.id, name: p.name }));

    socket.emit('voice_peers', { peers });
    socket.to(ctx.roomId).emit('voice_peer_joined', { playerId: ctx.player.id, name: ctx.player.name });
    broadcastGameState(ctx.roomId);
  });

  socket.on('voice_leave', () => {
    leaveVoice(findMe());
  });

  // Relay de señalización dirigido a UN peer concreto de la misma sala.
  socket.on('voice_signal', ({ to, data }) => {
    const ctx = findMe();
    if (!ctx || !to || !data) return;

    const target = ctx.game.players.find(p => p.id === to);
    // Solo se retransmite dentro de la sala y a alguien realmente conectado:
    // el servidor no es un relay abierto.
    if (!target || !target.socketId) return;

    io.to(target.socketId).emit('voice_signal', { from: ctx.player.id, data });
  });

  // Quién está hablando. Va aparte del game_state porque cambia ~1 vez/seg y
  // no queremos reemitir la partida entera por eso.
  socket.on('voice_speaking', ({ speaking }) => {
    const ctx = findMe();
    if (!ctx || !ctx.player.inVoice) return;
    socket.to(ctx.roomId).emit('voice_speaking', { playerId: ctx.player.id, speaking: !!speaking });
  });

  // 10. Desconexión
  socket.on('disconnect', () => {
    leaveVoice(findMe());
    console.log(`Cliente desconectado: ${socket.id}`);
    
    // Buscar la sala donde estaba este socket
    for (const [roomId, game] of rooms.entries()) {
      const player = game.players.find(p => p.socketId === socket.id);
      if (player) {
        if (game.status === 'waiting') {
          // Si estaba esperando, lo sacamos de inmediato
          game.removePlayer(socket.id);
          console.log(`Jugador ${player.name} abandonó la sala en espera ${roomId}`);
          
          // Con bots la sala nunca queda en 0 jugadores: lo que la vacía de
          // verdad es que no quede ningún humano.
          if (!game.hasHumans()) {
            rooms.delete(roomId);
            clearRoomTimers(roomId);
            console.log(`Sala sin humanos eliminada: ${roomId}`);
          } else {
            broadcastGameState(roomId);
          }
          broadcastLobby(); // la sala se fue de la lista, o le quedó un hueco
        } else {
          // Si la partida está activa, no lo eliminamos, marcamos socketId como nulo para darle tiempo a reconectar
          player.socketId = null;
          broadcastGameState(roomId);
          console.log(`Jugador ${player.name} se desconectó temporalmente de la sala activa ${roomId}`);
          
          // Limpieza de sala si todos están desconectados
          const allOffline = game.players.every(p => p.socketId === null);
          if (allOffline) {
            // Dar 2 minutos antes de borrar la sala entera
            setTimeout(() => {
              const checkGame = rooms.get(roomId);
              if (checkGame && checkGame.players.every(p => p.socketId === null)) {
                rooms.delete(roomId);
                clearRoomTimers(roomId);
                broadcastLobby();
                console.log(`Sala ${roomId} eliminada por inactividad prolongada (todos offline).`);
              }
            }, 120000);
          }
        }
        break;
      }
    }

    onlineCount = Math.max(0, onlineCount - 1);
    broadcastStats();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
