const DominoGame = require('./gameLogic');
const GameRegistry = require('./core/GameRegistry');
// La IA de dominó (chooseMove/choosePower) ya NO se usa aquí: cada juego pilota
// sus bots vía game.playBotTurn(). Solo se conserva el generador de nombres.
const { pickBotName } = require('./botLogic');
const seatAliases = require('./seatAliases');

// Almacén de salas activas: roomId -> BaseGame (DominoGame, etc.)
const rooms = new Map();

// Espectadores por sala: roomId -> Set<socketId>
const spectators = new Map();

// Temporizadores por sala: roomId -> handle
const turnTimers = new Map();   // reloj de turno
const effectTimers = new Map(); // caducidad de efectos (p. ej. Ojo Soplón)
const botTimers = new Map();    // "pensar" de los bots antes de jugar
const roundTimers = new Map();  // auto-avance de round_ended sin humano que pulse "siguiente"

let onlineCount = 0;

const TURN_SECONDS = Math.max(5, Number(process.env.TURN_SECONDS) || 30);

// Tope global de salas simultáneas: cortafuegos anti-DoS por creación masiva.
// Con 512 MB de RAM en Render, unos pocos miles de salas ya es mucho.
const MAX_ROOMS = Math.max(50, Number(process.env.MAX_ROOMS) || 3000);
function roomsAtCapacity() {
  return rooms.size >= MAX_ROOMS;
}

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
  clearTimeout(roundTimers.get(roomId));
  turnTimers.delete(roomId);
  effectTimers.delete(roomId);
  botTimers.delete(roomId);
  roundTimers.delete(roomId);
}

function destroyRoom(io, roomId) {
  io.to(roomId).emit('room_closed');
  rooms.delete(roomId);
  spectators.delete(roomId);
  clearRoomTimers(roomId);
  forgetRoom(roomId);
  seatAliases.olvidarSala(roomId);
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

  // Único punto de salida del estado: aquí se sustituyen los ids de cuenta por
  // alias de asiento, para que el id persistente de un jugador no viaje a sus
  // rivales ni a los espectadores. El estado se construye con los ids reales
  // (el motor decide con ellos qué mano revelar) y se traduce al final.
  seatAliases.registrarJugadores(roomId, game.players);
  const aliasar = (estado) => seatAliases.aliasarEstado(roomId, estado);

  game.players.forEach(player => {
    if (player.socketId) {
      io.to(player.socketId).emit('game_state', aliasar(game.getGameStateForPlayer(player.id, shared)));
    }
  });

  const specs = spectatorsOf(roomId);
  if (specs && specs.size) {
    const specView = aliasar(game.getSpectatorState(shared));
    for (const sid of specs) io.to(sid).emit('game_state', specView);
  }
}

function publicRoomsList(gameTypeFilter = null) {
  const list = [];
  for (const [roomId, game] of rooms.entries()) {
    if (!game.isPublic || game.status !== 'waiting' || game.players.length >= (game.maxPlayers || 4)) continue;
    if (gameTypeFilter && game.gameType !== gameTypeFilter) continue;
    const host = game.players.find(p => !p.isBot);
    list.push({
      roomId,
      gameType: game.gameType || 'domino',
      host: host ? host.name : '—',
      players: game.players.length,
      maxPlayers: game.maxPlayers || 4,
      bots: game.players.filter(p => p.isBot).length,
      maxPip: game.maxPip,
      maxScore: game.maxScore,
      powersEnabled: game.powersEnabled,
      teamsEnabled: game.teamsEnabled,
      drawEnabled: game.drawEnabled,
      ranked: game.ranked
    });
  }
  return list.sort((a, b) => b.players - a.players);
}

function spectatableRoomsList(gameTypeFilter = null) {
  const list = [];
  for (const [roomId, game] of rooms.entries()) {
    if (!game.isPublic || game.status !== 'playing') continue;
    if (gameTypeFilter && game.gameType !== gameTypeFilter) continue;
    list.push({
      roomId,
      gameType: game.gameType || 'domino',
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

// Un lobby por juego. `publicRoomsList`/`spectatableRoomsList` aceptaban un
// filtro por tipo desde el principio y NUNCA se les pasaba: el lobby del tres
// en raya listaba las salas de dominó y te dejaba entrar en ellas.
function salaDeLobby(gameType) {
  return `lobby:${gameType || 'domino'}`;
}

function tiposDeJuego() {
  try {
    return GameRegistry.listGames().map(g => g.gameType);
  } catch {
    return ['domino'];
  }
}

/**
 * Saca al socket de TODOS los lobbies (el global de estadísticas y el de cada
 * juego). Se sale del lobby desde varios sitios —crear sala, partida rápida,
 * espectar— y hacerlo a mano en cada uno era la forma de olvidarse de uno.
 */
function salirDeLobbies(socket) {
  socket.leave('lobby');
  for (const tipo of tiposDeJuego()) socket.leave(salaDeLobby(tipo));
}

function broadcastLobby(io) {
  for (const gameType of tiposDeJuego()) {
    const sala = salaDeLobby(gameType);
    io.to(sala).emit('rooms_list', publicRoomsList(gameType));
    io.to(sala).emit('live_games', spectatableRoomsList(gameType));
  }
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

    // forceTurn debe devolver el contrato de BaseGame { action, playerName, drew }.
    // Se tolera un retorno pobre (juego mal implementado) sin narrar basura.
    // Corre dentro de un timer: si lanzara, la excepción no tendría a nadie
    // encima y tumbaría el proceso entero (mismo criterio que scheduleBotTurn).
    let result;
    try {
      result = current.forceTurn();
    } catch (e) {
      console.warn(`[reloj] Error forzando el turno en ${roomId}:`, e.message);
      return;
    }
    if (!result || !result.action || result.action === 'none') {
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
      return;
    }

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

// Programa el turno del bot DELEGANDO en el propio juego (game.playBotTurn).
// El orquestador ya no conoce la IA de dominó ni el nombre del índice de turno:
// así un juego con otra API (tres en raya usa `currentPlayerIdx` y mueve sus
// propios bots) no revienta con un TypeError.
function scheduleBotTurn(io, roomId) {
  const game = rooms.get(roomId);
  clearTimeout(botTimers.get(roomId));
  botTimers.delete(roomId);

  if (!game || game.status !== 'playing') return;
  // Juegos que pilotan sus propios bots (p. ej. TicTacToe) se autogestionan.
  if (typeof game.handlesOwnBots === 'function' && game.handlesOwnBots()) return;
  if (typeof game.playBotTurn !== 'function') return;

  const current = typeof game.getCurrentPlayer === 'function' ? game.getCurrentPlayer() : null;
  if (!current || !current.isBot) return;

  const thinkMs = 700 + Math.floor(Math.random() * 900);

  botTimers.set(roomId, setTimeout(() => {
    botTimers.delete(roomId);
    const g = rooms.get(roomId);
    if (!g || g.status !== 'playing') return;

    const bot = g.getCurrentPlayer();
    if (!bot || !bot.isBot) return;

    let result;
    try {
      result = g.playBotTurn(bot.id);
    } catch (e) {
      // Un fallo de la IA no debe tumbar el proceso (corre dentro de un timer).
      console.warn(`[bot] Error jugando el turno en ${roomId}:`, e.message);
      return;
    }

    if (result && result.usedPower) {
      io.to(roomId).emit('play_sound', { type: 'power' });
      io.to(roomId).emit('receive_quick_message', {
        playerName: 'SISTEMA',
        key: 'srv.sys.botUsedPower',
        params: { name: bot.name },
        type: 'phrase'
      });
    }

    if (result && result.action !== 'none') {
      const tile = result.tile;
      const isDouble = Array.isArray(tile) && tile[0] === tile[1];
      io.to(roomId).emit('play_sound', {
        type: result.action === 'played' ? (isDouble ? 'double_place' : 'place') : 'pass',
        tile: tile || undefined
      });
    }

    advanceRoom(io, roomId);
    broadcastGameState(io, roomId);
  }, thinkMs));
}

// Auto-avanza de 'round_ended' a la siguiente ronda cuando NO hay ningún humano
// conectado que pueda pulsar "siguiente ronda": partidas de torneo/ranked (donde
// el rival es un bot o el humano se desconectó) o salas con todos desconectados.
// Sin esto, una ronda de torneo terminada se queda congelada para siempre y con
// ella el cuadro entero (onMatchEnd no llega a dispararse). En salas casuales con
// al menos un humano conectado se respeta el botón manual y no se programa nada.
function scheduleRoundAdvance(io, roomId) {
  const game = rooms.get(roomId);
  clearTimeout(roundTimers.get(roomId));
  roundTimers.delete(roomId);

  if (!game || game.status !== 'round_ended') return;

  const hasConnectedHuman = game.players.some(p => !p.isBot && p.socketId);
  const mustAutoAdvance = game.tournamentId || game.ranked || !hasConnectedHuman;
  if (!mustAutoAdvance) return;

  roundTimers.set(roomId, setTimeout(() => {
    roundTimers.delete(roomId);
    const g = rooms.get(roomId);
    if (!g || g.status !== 'round_ended') return;
    // Igual que el reloj de turno: dentro de un timer, un fallo del motor no
    // debe tumbar el proceso.
    try {
      g.startNewRound();
    } catch (e) {
      console.warn(`[ronda] Error iniciando la siguiente ronda en ${roomId}:`, e.message);
      return;
    }
    io.to(roomId).emit('play_sound', { type: 'shuffle' });
    advanceRoom(io, roomId);
    broadcastGameState(io, roomId);
  }, 3500));
}

const { recordMatchEnd } = require('./db');

function advanceRoom(io, roomId) {
  const game = rooms.get(roomId);
  if (game && game.status === 'game_ended' && !game._matchRecorded) {
    game._matchRecorded = true;
    // Se pregunta al JUEGO por su resultado: leer `gameWinner`/`maxPip` a pelo
    // son campos del dominó y con otro juego se registraba basura.
    const winnerId = typeof game.getWinnerId === 'function' ? game.getWinnerId() : game.gameWinner;
    const winner = game.players.find(p => p.id === winnerId);
    const variante = typeof game.getVariantLabel === 'function'
      ? game.getVariantLabel()
      : `double_${game.maxPip || 6}`;

    // El ELO solo se mueve en clasificatoria y con al menos 2 humanos (nada de
    // farmear puntos ganando a los bots).
    // Clasificatoria y 1v1 entre humanos: nada de mover ELO ganando a bots.
    const humanCount = game.players.filter(p => !p.isBot).length;
    const applyElo = !!game.ranked && humanCount === 2;

    recordMatchEnd({
      id: `${roomId}_${Date.now()}`,
      roomId,
      variant: variante,
      teamsEnabled: game.teamsEnabled,
      winnerName: winner ? winner.name : (game.teamsEnabled && winnerId ? `Equipo ${winnerId.replace('team_', '') === '0' ? 'A' : 'B'}` : 'Empate'),
      winnerId: winnerId || null,
      finalScores: game.players.map(p => ({ id: p.id, name: p.name, score: p.score, team: p.team ?? null, isBot: !!p.isBot })),
      moveLog: game.moveLog || [],
      players: game.players,
      applyElo
    }).catch(e => console.warn('[BD] recordMatchEnd falló:', e && e.message));

    // Torneo: tras un breve respiro para ver el resultado, avanzar el cuadro
    // (la sala de esta partida se destruye dentro de onMatchEnd).
    if (game.tournamentId && !game._tournamentHandled) {
      game._tournamentHandled = true;
      const winnerId = game.gameWinner;
      setTimeout(() => {
        try {
          require('./tournamentManager').onMatchEnd(io, roomId, winnerId);
        } catch (e) {
          console.warn('[Torneo onMatchEnd]', e.message);
        }
      }, 3500);
    }
  }

  armTurnTimer(io, roomId);
  scheduleBotTurn(io, roomId);
  scheduleRoundAdvance(io, roomId);
}

function createRoomFor(io, socket, name, playerId, opts = {}) {
  const gameType = opts.gameType || 'domino';
  const safeMaxPip = opts.maxPip === 9 ? 9 : 6;
  const safePowers = opts.powersEnabled !== false;
  const safeTeams = opts.teamsEnabled === true;
  const safeDraw = opts.drawEnabled !== false;
  const safePublic = opts.isPublic !== false;
  const safeScore = [100, 150, 200, 300].includes(opts.maxScore) ? opts.maxScore : null;
  const safeIntensity = ['light', 'normal', 'chaos'].includes(opts.powerIntensity) ? opts.powerIntensity : 'normal';
  const safeOnePerTurn = opts.onePowerPerTurn === true;
  const safeBlitz = opts.isBlitzMode === true;
  // Las salas creadas por un jugador NUNCA son clasificatorias, dijera lo que
  // dijera el payload. El ELO solo se mueve en partidas que arma el servidor
  // desde la cola de emparejamiento (`createRankedMatch`).
  const safeRanked = false;
  const effectivePowers = safePowers;

  const roomId = generateRoomId();
  let game;
  try {
    game = GameRegistry.createGameInstance(gameType, roomId, {
      maxScore: safeScore,
      powersEnabled: effectivePowers,
      maxPip: safeMaxPip,
      teamsEnabled: safeTeams,
      drawEnabled: safeDraw,
      isPublic: safePublic,
      powerIntensity: safeIntensity,
      onePowerPerTurn: safeOnePerTurn,
      isBlitzMode: safeBlitz,
      ranked: safeRanked
    });
  } catch (e) {
    game = new DominoGame(roomId, safeScore, {
      powersEnabled: effectivePowers,
      maxPip: safeMaxPip,
      teamsEnabled: safeTeams,
      drawEnabled: safeDraw,
      isPublic: safePublic,
      powerIntensity: safeIntensity,
      onePowerPerTurn: safeOnePerTurn,
      isBlitzMode: safeBlitz,
      ranked: safeRanked
    });
  }
  game.turnDurationMs = TURN_SECONDS * 1000;

  const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
  game.addPlayer(actualPlayerId, name, socket.id);

  rooms.set(roomId, game);
  socket.join(roomId);
  salirDeLobbies(socket);

  console.log(`Sala creada: ${roomId} por ${name} (doble ${safeMaxPip}, ${safePublic ? 'pública' : 'privada'}, ` +
    `poderes: ${safePowers ? 'sí' : 'no'}, ${safeTeams ? 'parejas' : 'individual'}, ${game.maxScore} pts)`);

  return { roomId, playerId: actualPlayerId };
}

// Crea una sala 1v1 para una partida de torneo y la arranca. `seats` son dos
// plazas { seedIdx, id, name, isHuman, socketId }; cada humano se añade como
// jugador y cada bot con addBot. Devuelve el mapa playerId -> seedIdx.
// La sala es privada, sin poderes, y queda etiquetada con tournamentId/slot.
function createMatchRoom(io, { seats, maxScore, maxPip, tournamentId, slot }) {
  const roomId = generateRoomId();
  const game = new DominoGame(roomId, maxScore, {
    powersEnabled: false, maxPip, teamsEnabled: false, drawEnabled: true, isPublic: false
  });
  game.turnDurationMs = TURN_SECONDS * 1000;
  game.tournamentId = tournamentId;
  game.tournamentSlot = slot;

  const seedByPlayerId = {};
  for (const seat of seats) {
    if (seat.isHuman) {
      game.addPlayer(seat.id, seat.name, seat.socketId || null);
      const p = game.players.find(x => x.id === seat.id);
      if (p) p.ready = true;
      seedByPlayerId[seat.id] = seat.seedIdx;
    } else {
      const bot = game.addBot(seat.name, 'dificil');
      if (bot) seedByPlayerId[bot.id] = seat.seedIdx;
    }
  }

  game.startNewGame();
  rooms.set(roomId, game);

  return { roomId, seedByPlayerId };
}

// Crea una sala clasificatoria 1v1 (2 humanos, sin poderes, afecta al ELO).
function createRankedMatch(io, players) {
  const roomId = generateRoomId();
  const game = new DominoGame(roomId, null, {
    powersEnabled: false, maxPip: 6, teamsEnabled: false, drawEnabled: true, isPublic: false, ranked: true
  });
  game.turnDurationMs = TURN_SECONDS * 1000;
  for (const p of players) {
    game.addPlayer(p.id, p.name, p.socketId || null);
    const pl = game.players.find(x => x.id === p.id);
    if (pl) pl.ready = true;
  }
  game.startNewGame();
  rooms.set(roomId, game);
  return { roomId };
}

// Índice socketId → roomId. `findMe` se llama en casi todos los eventos de
// socket y recorría TODAS las salas cada vez: con MAX_ROOMS=3000 eso son 3000
// búsquedas lineales por evento.
//
// El índice es una CACHÉ, no la fuente de verdad: se valida contra la sala real
// en cada consulta y, si falla, se cae al escaneo y se reindexa. Así el
// `socketId` de un jugador puede reasignarse por ahí (reconexión, expulsión,
// desconexión) sin que una entrada obsoleta devuelva nunca un resultado
// incorrecto — sólo cuesta un escaneo puntual.
const socketIndex = new Map();

function findMe(socketId) {
  const cached = socketIndex.get(socketId);
  if (cached) {
    const game = rooms.get(cached);
    const player = game && game.players.find(p => p.socketId === socketId);
    if (player) return { roomId: cached, game, player };
    socketIndex.delete(socketId); // entrada obsoleta
  }

  for (const [roomId, game] of rooms.entries()) {
    const player = game.players.find(p => p.socketId === socketId);
    if (player) {
      socketIndex.set(socketId, roomId);
      return { roomId, game, player };
    }
  }
  return null;
}

// Olvidar un socket (al desconectar). No es imprescindible para la corrección
// —la validación de arriba ya cubre las entradas obsoletas— pero evita que el
// Map crezca con sockets muertos en un servidor de larga vida.
function forgetSocket(socketId) {
  socketIndex.delete(socketId);
}

// Al destruir una sala se tiran sus entradas: si no, quedarían apuntando a una
// sala inexistente hasta que ese socket volviera a preguntar.
function forgetRoom(roomId) {
  for (const [socketId, rid] of socketIndex.entries()) {
    if (rid === roomId) socketIndex.delete(socketId);
  }
}

module.exports = {
  rooms,
  spectators,
  roomsAtCapacity,
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
  salaDeLobby,
  tiposDeJuego,
  salirDeLobbies,
  armTurnTimer,
  scheduleEffectExpiry,
  scheduleBotTurn,
  advanceRoom,
  createRoomFor,
  createMatchRoom,
  createRankedMatch,
  findMe,
  forgetSocket,
  pickBotName
};
