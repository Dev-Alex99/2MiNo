const DominoGame = require('./gameLogic');
const { chooseMove, choosePower, pickBotName } = require('./botLogic');

// Almacén de salas activas: roomId -> DominoGame
const rooms = new Map();

// Espectadores por sala: roomId -> Set<socketId>
const spectators = new Map();

// Temporizadores por sala: roomId -> handle
const turnTimers = new Map();   // reloj de turno
const effectTimers = new Map(); // caducidad de efectos (p. ej. Ojo Soplón)
const botTimers = new Map();    // "pensar" de los bots antes de jugar

let onlineCount = 0;

const TURN_SECONDS = Math.max(5, Number(process.env.TURN_SECONDS) || 30);

function getOnlineCount() {
  return onlineCount;
}

function incOnlineCount() {
  onlineCount++;
  return onlineCount;
}

function decOnlineCount() {
  onlineCount = Math.max(0, onlineCount - 1);
  return onlineCount;
}

function spectatorsOf(roomId) {
  return spectators.get(roomId) || null;
}

function spectatorCount(roomId) {
  const set = spectators.get(roomId);
  return set ? set.size : 0;
}

function addSpectator(roomId, socketId) {
  if (!spectators.has(roomId)) spectators.set(roomId, new Set());
  spectators.get(roomId).add(socketId);
}

function removeSpectatorEverywhere(socketId) {
  let removed = false;
  for (const set of spectators.values()) {
    if (set.delete(socketId)) removed = true;
  }
  return removed;
}

function clearRoomTimers(roomId) {
  clearTimeout(turnTimers.get(roomId));
  clearTimeout(effectTimers.get(roomId));
  clearTimeout(botTimers.get(roomId));
  turnTimers.delete(roomId);
  effectTimers.delete(roomId);
  botTimers.delete(roomId);
}

function destroyRoom(io, roomId) {
  io.to(roomId).emit('room_closed');
  rooms.delete(roomId);
  spectators.delete(roomId);
  clearRoomTimers(roomId);
}

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

function broadcastGameState(io, roomId) {
  const game = rooms.get(roomId);
  if (!game) return;

  const shared = game.getSharedState();

  game.players.forEach(player => {
    if (player.socketId) {
      io.to(player.socketId).emit('game_state', game.getGameStateForPlayer(player.id, shared));
    }
  });

  const specs = spectatorsOf(roomId);
  if (specs && specs.size) {
    const specView = game.getSpectatorState(shared);
    for (const sid of specs) io.to(sid).emit('game_state', specView);
  }
}

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
  return list.sort((a, b) => b.players - a.players);
}

function spectatableRoomsList() {
  const list = [];
  for (const [roomId, game] of rooms.entries()) {
    if (!game.isPublic || game.status !== 'playing') continue;
    list.push({
      roomId,
      players: game.players.map(p => p.name),
      spectators: spectatorCount(roomId),
      maxPip: game.maxPip,
      maxScore: game.maxScore,
      powersEnabled: game.powersEnabled,
      teamsEnabled: game.teamsEnabled,
      roundNumber: game.roundNumber
    });
  }
  return list.sort((a, b) => b.spectators - a.spectators);
}

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

function broadcastStats(io) {
  io.to('lobby').emit('lobby_stats', lobbyStats());
}

function broadcastLobby(io) {
  io.to('lobby').emit('rooms_list', publicRoomsList());
  io.to('lobby').emit('live_games', spectatableRoomsList());
  broadcastStats(io);
}

function armTurnTimer(io, roomId) {
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

    const drew = result.drew > 0 ? result.drew : 0;
    const key = result.action === 'played'
      ? (drew ? 'srv.sys.timeoutPlayedDrew' : 'srv.sys.timeoutPlayed')
      : (drew ? 'srv.sys.timeoutPassedDrew' : 'srv.sys.timeoutPassed');

    io.to(roomId).emit('receive_quick_message', {
      playerName: 'SISTEMA',
      key,
      params: { name: result.playerName, n: drew },
      type: 'phrase'
    });
    io.to(roomId).emit('play_sound', { type: result.action === 'played' ? 'place' : 'pass' });

    advanceRoom(io, roomId);
    broadcastGameState(io, roomId);
  }, game.turnDurationMs));
}

function scheduleEffectExpiry(io, roomId, ms) {
  clearTimeout(effectTimers.get(roomId));
  effectTimers.set(roomId, setTimeout(() => {
    effectTimers.delete(roomId);
    if (rooms.has(roomId)) broadcastGameState(io, roomId);
  }, ms + 250));
}

function scheduleBotTurn(io, roomId) {
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
          key: 'srv.sys.botUsedPower',
          params: { name: bot.name },
          type: 'phrase'
        });
      }
    }

    // 2. Su jugada.
    const move = chooseMove(g, bot.id);
    if (move) {
      const played = g.playTile(bot.id, move.tileIndex, move.side);
      if (played.success) {
        const isDouble = g.lastPlay && g.lastPlay.tile && g.lastPlay.tile[0] === g.lastPlay.tile[1];
        io.to(roomId).emit('play_sound', { type: isDouble ? 'double_place' : 'place', tile: g.lastPlay.tile });
      } else {
        g.forceTurn();
      }
    } else {
      const result = g.forceTurn();
      const isDouble = g.lastPlay && g.lastPlay.tile && g.lastPlay.tile[0] === g.lastPlay.tile[1];
      io.to(roomId).emit('play_sound', { type: result.action === 'played' ? (isDouble ? 'double_place' : 'place') : 'pass' });
    }

    advanceRoom(io, roomId);
    broadcastGameState(io, roomId);
  }, thinkMs));
}

const { recordMatchEnd } = require('./db');

function advanceRoom(io, roomId) {
  const game = rooms.get(roomId);
  if (game && (game.status === 'round_ended' || game.status === 'game_ended') && !game._matchRecorded) {
    game._matchRecorded = true;
    const isGameEnd = game.status === 'game_ended';
    const winnerId = isGameEnd ? game.gameWinner : game.roundWinner;
    const winner = game.players.find(p => p.id === winnerId);
    
    recordMatchEnd({
      id: `${roomId}_${Date.now()}`,
      roomId,
      variant: `double_${game.maxPip || 6}`,
      teamsEnabled: game.teamsEnabled,
      winnerName: winner ? winner.name : (game.teamsEnabled ? `Equipo ${winnerId}` : 'Empate'),
      winnerId: winnerId || null,
      finalScores: game.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
      moveLog: game.moveLog || [],
      players: game.players
    });
  }

  armTurnTimer(io, roomId);
  scheduleBotTurn(io, roomId);
}

function createRoomFor(io, socket, name, playerId, opts = {}) {
  const safeMaxPip = opts.maxPip === 9 ? 9 : 6;
  const safePowers = opts.powersEnabled !== false;
  const safeTeams = opts.teamsEnabled === true;
  const safeDraw = opts.drawEnabled !== false;
  const safePublic = opts.isPublic !== false;
  const safeScore = [100, 150, 200, 300].includes(opts.maxScore) ? opts.maxScore : null;
  const safeIntensity = ['light', 'normal', 'chaos'].includes(opts.powerIntensity) ? opts.powerIntensity : 'normal';
  const safeOnePerTurn = opts.onePowerPerTurn === true;
  const safeBlitz = opts.isBlitzMode === true;

  const roomId = generateRoomId();
  const game = new DominoGame(roomId, safeScore, {
    powersEnabled: safePowers,
    maxPip: safeMaxPip,
    teamsEnabled: safeTeams,
    drawEnabled: safeDraw,
    isPublic: safePublic,
    powerIntensity: safeIntensity,
    onePowerPerTurn: safeOnePerTurn,
    isBlitzMode: safeBlitz
  });
  game.turnDurationMs = TURN_SECONDS * 1000;

  const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
  game.addPlayer(actualPlayerId, name, socket.id);

  rooms.set(roomId, game);
  socket.join(roomId);
  socket.leave('lobby');

  console.log(`Sala creada: ${roomId} por ${name} (doble ${safeMaxPip}, ${safePublic ? 'pública' : 'privada'}, ` +
    `poderes: ${safePowers ? 'sí' : 'no'}, ${safeTeams ? 'parejas' : 'individual'}, ${game.maxScore} pts)`);

  return { roomId, playerId: actualPlayerId };
}

function findMe(socketId) {
  for (const [roomId, game] of rooms.entries()) {
    const player = game.players.find(p => p.socketId === socketId);
    if (player) return { roomId, game, player };
  }
  return null;
}

module.exports = {
  rooms,
  spectators,
  getOnlineCount,
  incOnlineCount,
  decOnlineCount,
  spectatorsOf,
  spectatorCount,
  addSpectator,
  removeSpectatorEverywhere,
  clearRoomTimers,
  destroyRoom,
  generateRoomId,
  broadcastGameState,
  publicRoomsList,
  spectatableRoomsList,
  lobbyStats,
  broadcastStats,
  broadcastLobby,
  armTurnTimer,
  scheduleEffectExpiry,
  scheduleBotTurn,
  advanceRoom,
  createRoomFor,
  findMe,
  pickBotName
};
