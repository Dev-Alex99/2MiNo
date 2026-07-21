const {
  rooms,
  createRoomFor,
  publicRoomsList,
  broadcastGameState,
  broadcastLobby,
  destroyRoom,
  advanceRoom,
  findMe,
  pickBotName
} = require('../roomManager');

const {
  createRoomSchema,
  quickPlaySchema,
  joinRoomSchema,
  addBotSchema,
  removeBotSchema,
  swapSeatsSchema,
  kickPlayerSchema,
  toggleReadySchema,
  validate
} = require('../schemas');
const { getGlobalLeaderboard, getOrCreateUser, getUserProfile, equipItem } = require('../db');

function registerRoomHandlers(io, socket, leaveVoiceFn) {
  // 0. Clasificación Global y Perfil Supabase
  socket.on('get_leaderboard', async () => {
    const leaderboard = await getGlobalLeaderboard(15);
    socket.emit('leaderboard_data', leaderboard);
  });

  socket.on('get_profile', async ({ playerId, username }) => {
    if (!playerId) return;
    await getOrCreateUser(playerId, username || 'Jugador');
    const profile = await getUserProfile(playerId);
    socket.emit('profile_data', profile);
  });

  socket.on('equip_skin', async ({ playerId, category, itemId, username }) => {
    if (!playerId || !category || !itemId) return;
    // El precio lo decide el servidor (storeCatalog); ignoramos cualquier coste del cliente.
    const result = await equipItem(playerId, category, itemId, username || 'Jugador');
    socket.emit('skin_equipped', result);
  });

  // 1. Crear sala
  socket.on('create_room', (data) => {
    const v = validate(createRoomSchema, data);
    if (!v.success) return socket.emit('error_msg', { key: v.errorKey });

    const { name, playerId, ...opts } = v.data;
    const created = createRoomFor(io, socket, name, playerId, opts);
    getOrCreateUser(created.playerId, name);
    socket.emit('room_created', created);
    broadcastGameState(io, created.roomId);
    broadcastLobby(io);
  });

  // 1.6 Partida rápida
  socket.on('quick_play', (data) => {
    const v = validate(quickPlaySchema, data);
    if (!v.success) return socket.emit('error_msg', { key: v.errorKey });

    const { name, playerId } = v.data;
    const candidate = publicRoomsList()[0];

    if (candidate) {
      const game = rooms.get(candidate.roomId);
      const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
      if (game && game.addPlayer(actualPlayerId, name, socket.id)) {
        getOrCreateUser(actualPlayerId, name);
        socket.join(candidate.roomId);
        socket.leave('lobby');
        socket.emit('room_joined', { roomId: candidate.roomId, playerId: actualPlayerId });
        broadcastGameState(io, candidate.roomId);
        broadcastLobby(io);
        console.log(`Partida rápida: ${name} -> sala ${candidate.roomId}`);
        return;
      }
    }

    const created = createRoomFor(io, socket, name, playerId, { isPublic: true, powersEnabled: false });
    socket.emit('room_created', created);
    broadcastGameState(io, created.roomId);
    broadcastLobby(io);
    console.log(`Partida rápida: ${name} abrió sala nueva ${created.roomId}`);
  });

  // 2. Unirse a sala
  socket.on('join_room', (data) => {
    const v = validate(joinRoomSchema, data);
    if (!v.success) return socket.emit('error_msg', { key: v.errorKey });

    let { roomId, name, playerId } = v.data;
    roomId = roomId.trim().toUpperCase();
    const game = rooms.get(roomId);

    if (!game) {
      return socket.emit('error_msg', { key: 'srv.err.roomNotFound' });
    }

    const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
    const existingPlayer = game.players.find(p => p.id === actualPlayerId);

    if (existingPlayer) {
      existingPlayer.socketId = socket.id;
      socket.join(roomId);
      socket.emit('room_joined', { roomId, playerId: actualPlayerId });
      broadcastGameState(io, roomId);
      broadcastLobby(io);
      console.log(`Jugador reconectado: ${existingPlayer.name} a sala ${roomId}`);
      return;
    }

    if (game.players.length >= 4) {
      return socket.emit('error_msg', { key: 'srv.err.roomFull' });
    }
    if (game.status !== 'waiting') {
      return socket.emit('error_msg', { key: 'srv.err.gameStarted' });
    }
    if (!name) {
      return socket.emit('error_msg', { key: 'srv.err.nameRequired' });
    }

    getOrCreateUser(actualPlayerId, name);
    game.addPlayer(actualPlayerId, name, socket.id);
    socket.join(roomId);

    socket.emit('room_joined', { roomId, playerId: actualPlayerId });
    broadcastGameState(io, roomId);
    broadcastLobby(io);
    console.log(`Jugador ${name} se unió a sala ${roomId}`);
  });

  // 2.5 Añadir bot
  socket.on('add_bot', (data) => {
    const v = validate(addBotSchema, data);
    if (!v.success) return socket.emit('error_msg', { key: v.errorKey });

    const { roomId, difficulty } = v.data;
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error_msg', { key: 'srv.err.roomNotFound' });
    if (game.status !== 'waiting') return socket.emit('error_msg', { key: 'srv.err.noBotsInGame' });
    if (game.players.length >= 4) return socket.emit('error_msg', { key: 'srv.err.roomFull' });

    const bot = game.addBot(pickBotName(game.players.map(p => p.name)), difficulty);
    if (!bot) return socket.emit('error_msg', { key: 'srv.err.botAddFailed' });

    broadcastGameState(io, roomId);
    broadcastLobby(io);
    console.log(`Bot ${bot.name} (${bot.difficulty}) añadido a sala ${roomId}`);

    if (game.allReady()) {
      game.startNewGame();
      io.to(roomId).emit('game_started');
      broadcastLobby(io);
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    }
  });

  // Quitar bot
  socket.on('remove_bot', (data) => {
    const v = validate(removeBotSchema, data);
    if (!v.success) return;

    const { roomId, botId } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;
    if (game.status !== 'waiting') return socket.emit('error_msg', { key: 'srv.err.noRemoveBotInGame' });

    const target = game.players.find(p => p.id === botId);
    if (!target || !target.isBot) return socket.emit('error_msg', { key: 'srv.err.notABot' });

    game.removePlayerById(botId);
    broadcastGameState(io, roomId);
    broadcastLobby(io);
  });

  // 2.6 Intercambiar asientos
  socket.on('swap_seats', (data) => {
    const v = validate(swapSeatsSchema, data);
    if (!v.success) return;

    const { roomId, playerA, playerB } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;
    if (game.status !== 'waiting') {
      return socket.emit('error_msg', { key: 'srv.err.noSwapInGame' });
    }
    if (!game.swapSeats(playerA, playerB)) {
      return socket.emit('error_msg', { key: 'srv.err.swapFailed' });
    }

    game.players.forEach(p => { if (!p.isBot) p.ready = false; });
    broadcastGameState(io, roomId);
  });

  // 2.8 Expulsar jugador
  socket.on('kick_player', (data) => {
    const v = validate(kickPlayerSchema, data);
    if (!v.success) return;

    const ctx = findMe(socket.id);
    if (!ctx) return;
    const { roomId, game, player } = ctx;
    const { targetId } = v.data;

    if (game.hostId !== player.id) {
      return socket.emit('error_msg', { key: 'srv.err.onlyHostKick' });
    }
    if (!targetId || targetId === player.id) {
      return socket.emit('error_msg', { key: 'srv.err.cantKickSelf' });
    }
    const target = game.players.find(p => p.id === targetId);
    if (!target) return;

    const targetSocketId = target.socketId;

    if (target.isBot || game.status === 'waiting') {
      game.removePlayerById(targetId);
    } else {
      target.isBot = true;
      target.difficulty = 'normal';
      target.socketId = null;
      target.ready = true;
      game.ensureHost();
    }

    if (targetSocketId && !target.isBot) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) targetSocket.leave(roomId);
    }
    if (targetSocketId) {
      io.to(targetSocketId).emit('kicked', { by: player.name });
    }

    io.to(roomId).emit('receive_quick_message', {
      playerName: 'SISTEMA',
      key: 'srv.sys.kicked',
      params: { name: player.name, target: target.name },
      type: 'phrase'
    });

    if (!game.hasHumans()) {
      destroyRoom(io, roomId);
      broadcastLobby(io);
      return;
    }

    advanceRoom(io, roomId);
    broadcastGameState(io, roomId);
    broadcastLobby(io);
    console.log(`${player.name} expulsó a ${target.name} de ${roomId}`);
  });

  // 2.7 Abandonar sala
  socket.on('leave_room', () => {
    const ctx = findMe(socket.id);
    if (!ctx) return;
    const { roomId, game, player } = ctx;

    if (typeof leaveVoiceFn === 'function') {
      leaveVoiceFn(ctx);
    }
    socket.leave(roomId);

    if (game.status === 'waiting') {
      game.removePlayerById(player.id);
    } else {
      player.isBot = true;
      player.difficulty = 'normal';
      player.socketId = null;
      player.ready = true;

      io.to(roomId).emit('receive_quick_message', {
        playerName: 'SISTEMA',
        key: 'srv.sys.leftGame',
        params: { name: player.name },
        type: 'phrase'
      });
      game.ensureHost();
    }

    if (!game.hasHumans()) {
      destroyRoom(io, roomId);
      broadcastLobby(io);
      console.log(`Sala ${roomId} eliminada: se fue el último humano`);
      return;
    }

    advanceRoom(io, roomId);
    broadcastGameState(io, roomId);
    broadcastLobby(io);
    console.log(`${player.name} abandonó la sala ${roomId}`);
  });

  // 3. Cambiar estado Listo
  socket.on('toggle_ready', (data) => {
    const v = validate(toggleReadySchema, data);
    if (!v.success) return;

    const { roomId } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;

    game.toggleReady(socket.id);
    broadcastGameState(io, roomId);

    if (game.allReady()) {
      game.startNewGame();
      io.to(roomId).emit('game_started');
      broadcastLobby(io);
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
      console.log(`Partida iniciada en sala ${roomId}`);
    }
  });
}

module.exports = registerRoomHandlers;
