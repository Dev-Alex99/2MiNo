// Torneo de eliminación directa (4 plazas, llaves 1v1). Admite 1–4 humanos;
// las plazas libres se rellenan con bots. El caso de 1 humano es el modo
// "solo vs IA"; con 2+ humanos las semifinales con humanos son salas reales y
// concurrentes, y la final espera a que ambas semifinales terminen.
//
// Siembra [0,2,1,3]: los humanos (empezando por el anfitrión) se reparten para
// no eliminarse entre sí en la primera ronda si se puede evitar.
//   SF1 = plaza 0 vs plaza 1     SF2 = plaza 2 vs plaza 3     FINAL = ganadores
// Las partidas de solo-bots se resuelven headless (simulación con el motor).

const DominoGame = require('./gameLogic');
const { chooseMove, pickBotName } = require('./botLogic');

const tournaments = new Map();      // id -> tournament
const roomToTournament = new Map(); // roomId -> { tournamentId, slot }

const REWARD = 150;
const RUNNER_UP = 50;   // premio de subcampeón (finalista que no gana)
const MATCH_MAX_SCORE = 50;
const MATCH_MAX_PIP = 6;
const SEED_ORDER = [0, 2, 1, 3];

function genId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id;
  do {
    id = 'T';
    for (let i = 0; i < 4; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (tournaments.has(id));
  return id;
}

// --- Simulación headless de una partida entre dos bots. Devuelve 'a' o 'b'. ---
function simulateBotMatch() {
  const g = new DominoGame('SIM', MATCH_MAX_SCORE, {
    powersEnabled: false, maxPip: MATCH_MAX_PIP, teamsEnabled: false, drawEnabled: true, isPublic: false
  });
  const a = g.addBot('SimA', 'dificil');
  const b = g.addBot('SimB', 'dificil');
  g.startNewGame();
  let guard = 0;
  while (g.status !== 'game_ended' && guard++ < 20000) {
    if (g.status === 'round_ended') { g.startNewRound(); continue; }
    if (g.status !== 'playing') break;
    const cur = g.players[g.currentPlayerIndex];
    if (!cur) break;
    const mv = chooseMove(g, cur.id);
    if (mv) { const r = g.playTile(cur.id, mv.tileIndex, mv.side); if (!r.success) g.forceTurn(); }
    else g.forceTurn();
  }
  return g.gameWinner === a.id ? 'a' : 'b';
}

// --- Utilidades de plazas ---
function seedsOfSlot(slot) {
  if (slot === 'sf1') return [0, 1];
  if (slot === 'sf2') return [2, 3];
  return null; // final: dinámico
}
function humanSocket(t, seedIdx) {
  const seed = t.seeds[seedIdx];
  if (!seed || !seed.isHuman) return null;
  const h = t.humans.find(x => x.id === seed.id);
  return h ? h.socketId : null;
}

// --- Estado serializable, personalizado por humano (marca su plaza) ---
function publicState(t, human) {
  const seeded = t.seeds.some(Boolean);
  const youSeed = seeded ? t.seeds.findIndex(s => s && s.isHuman && s.id === human.id) : -1;

  let yourMatchRoomId = null;
  for (const slot of ['sf1', 'sf2', 'final']) {
    const m = t.bracket[slot];
    if (!m.roomId || m.winner != null) continue;
    const inMatch = slot === 'final'
      ? (youSeed === t.bracket.final.a || youSeed === t.bracket.final.b)
      : seedsOfSlot(slot).includes(youSeed);
    if (inMatch) { yourMatchRoomId = m.roomId; break; }
  }

  return {
    id: t.id,
    code: t.id,
    status: t.status,
    reward: t.reward,
    runnerUp: RUNNER_UP,
    isHost: human.id === t.hostId,
    humans: t.humans.map(h => ({ name: h.name })),
    seeds: seeded ? t.seeds.map(s => ({ name: s ? s.name : '—', isHuman: !!(s && s.isHuman) })) : null,
    bracket: {
      sf1: { a: 0, b: 1, winner: t.bracket.sf1.winner },
      sf2: { a: 2, b: 3, winner: t.bracket.sf2.winner },
      final: { a: t.bracket.final.a, b: t.bracket.final.b, winner: t.bracket.final.winner }
    },
    championSeed: t.championSeed,
    youSeed,
    yourMatchRoomId
  };
}

function emitState(io, t) {
  for (const h of t.humans) {
    if (h.socketId) io.to(h.socketId).emit('tournament_state', publicState(t, h));
  }
}

function newBracket() {
  return {
    sf1: { winner: null, roomId: null, seedByPlayerId: {} },
    sf2: { winner: null, roomId: null, seedByPlayerId: {} },
    final: { a: null, b: null, winner: null, roomId: null, seedByPlayerId: {} }
  };
}

// --- Crear / unirse en el lobby ---
function createTournament(io, socket, human) {
  const id = genId();
  const t = {
    id,
    status: 'lobby',
    reward: REWARD,
    hostId: human.id,
    humans: [{ id: human.id, name: human.name, socketId: socket.id }],
    seeds: [null, null, null, null],
    bracket: newBracket(),
    championSeed: null
  };
  tournaments.set(id, t);
  emitState(io, t);
  return t;
}

function joinTournament(io, socket, code, human) {
  const t = tournaments.get(String(code || '').trim().toUpperCase());
  if (!t) { socket.emit('tournament_error', { key: 'tourney.err.notFound' }); return; }
  if (t.status !== 'lobby') { socket.emit('tournament_error', { key: 'tourney.err.started' }); return; }

  const existing = t.humans.find(h => h.id === human.id);
  if (existing) { existing.socketId = socket.id; emitState(io, t); return; }
  if (t.humans.length >= 4) { socket.emit('tournament_error', { key: 'tourney.err.full' }); return; }

  t.humans.push({ id: human.id, name: human.name, socketId: socket.id });
  emitState(io, t);
}

// --- Arranque: sembrar plazas y lanzar semifinales ---
function startTournament(io, tournamentId, socketId) {
  const t = tournaments.get(tournamentId);
  if (!t || t.status !== 'lobby') return;

  // Solo el anfitrión puede iniciar (y no se reasigna su socket desde un tercero).
  const caller = t.humans.find(h => h.socketId === socketId);
  if (!caller || caller.id !== t.hostId) return;

  // Sembrar: humanos según SEED_ORDER, bots en el resto.
  const seeds = [null, null, null, null];
  t.humans.forEach((h, i) => {
    if (i < 4) seeds[SEED_ORDER[i]] = { id: h.id, name: h.name, isHuman: true };
  });
  const used = t.humans.map(h => h.name);
  for (let i = 0; i < 4; i++) {
    if (!seeds[i]) {
      const bn = pickBotName(used); used.push(bn);
      seeds[i] = { name: bn, isHuman: false };
    }
  }
  t.seeds = seeds;
  t.status = 'active';

  for (const slot of ['sf1', 'sf2']) {
    const [ia, ib] = seedsOfSlot(slot);
    if (seeds[ia].isHuman || seeds[ib].isHuman) {
      startRealMatch(io, t, slot, ia, ib);
    } else {
      t.bracket[slot].winner = simulateBotMatch() === 'a' ? ia : ib;
    }
  }
  // Si por algún motivo ambas semis ya están decididas (p. ej. sin humanos), montar final.
  if (t.bracket.sf1.winner != null && t.bracket.sf2.winner != null) startFinal(io, t);

  emitState(io, t);
}

function buildSeat(t, seedIdx) {
  const s = t.seeds[seedIdx];
  return {
    seedIdx,
    id: s.isHuman ? s.id : undefined,
    name: s.name,
    isHuman: !!s.isHuman,
    socketId: s.isHuman ? humanSocket(t, seedIdx) : null
  };
}

function startRealMatch(io, t, slot, ia, ib) {
  const roomManager = require('./roomManager');
  const seats = [buildSeat(t, ia), buildSeat(t, ib)];
  const { roomId, seedByPlayerId } = roomManager.createMatchRoom(io, {
    seats, maxScore: MATCH_MAX_SCORE, maxPip: MATCH_MAX_PIP, tournamentId: t.id, slot
  });
  t.bracket[slot].roomId = roomId;
  t.bracket[slot].seedByPlayerId = seedByPlayerId;
  roomToTournament.set(roomId, { tournamentId: t.id, slot });

  // El cliente entra a su partida vía tournament_state.yourMatchRoomId (botón),
  // así que aquí basta con armar los temporizadores de la sala.
  roomManager.advanceRoom(io, roomId);
}

// --- Fin de una partida real (llamado desde roomManager.advanceRoom) ---
function onMatchEnd(io, roomId, winnerPlayerId) {
  const ref = roomToTournament.get(roomId);
  if (!ref) return;
  const t = tournaments.get(ref.tournamentId);
  if (!t) { roomToTournament.delete(roomId); return; }

  const slot = ref.slot;
  const map = t.bracket[slot].seedByPlayerId || {};
  const winnerSeed = (map[winnerPlayerId] !== undefined) ? map[winnerPlayerId] : (slot === 'final' ? t.bracket.final.a : seedsOfSlot(slot)[0]);
  t.bracket[slot].winner = winnerSeed;

  const roomManager = require('./roomManager');
  roomManager.destroyRoom(io, roomId);
  roomToTournament.delete(roomId);

  if (slot === 'sf1' || slot === 'sf2') {
    if (t.bracket.sf1.winner != null && t.bracket.sf2.winner != null) {
      startFinal(io, t);
    }
    // Si la otra semi sigue en juego, este humano espera (el estado lo refleja).
  } else if (slot === 'final') {
    finish(io, t, winnerSeed);
  }
  emitState(io, t);
}

function startFinal(io, t) {
  t.bracket.final.a = t.bracket.sf1.winner;
  t.bracket.final.b = t.bracket.sf2.winner;
  const a = t.bracket.final.a, b = t.bracket.final.b;

  if (t.seeds[a].isHuman || t.seeds[b].isHuman) {
    startRealMatch(io, t, 'final', a, b);
  } else {
    const w = simulateBotMatch() === 'a' ? a : b;
    t.bracket.final.winner = w;
    finish(io, t, w);
  }
}

function finish(io, t, championSeed) {
  t.status = 'finished';
  t.championSeed = championSeed;

  const db = require('./db');
  const award = (typeof db.awardTournamentPrize === 'function') ? db.awardTournamentPrize : null;

  const champ = t.seeds[championSeed];
  if (award && champ && champ.isHuman && champ.id) award(champ.id, t.reward, { won: true });

  // Subcampeón: el otro finalista.
  const runnerSeed = championSeed === t.bracket.final.a ? t.bracket.final.b : t.bracket.final.a;
  const runner = runnerSeed != null ? t.seeds[runnerSeed] : null;
  if (award && runner && runner.isHuman && runner.id) award(runner.id, RUNNER_UP, { won: false });

  emitState(io, t);

  // Liberar el torneo de memoria tras una gracia (para que los clientes vean el
  // resultado). Evita que el Map de torneos crezca sin límite.
  setTimeout(() => {
    for (const slot of ['sf1', 'sf2', 'final']) {
      const rid = t.bracket[slot] && t.bracket[slot].roomId;
      if (rid) roomToTournament.delete(rid);
    }
    tournaments.delete(t.id);
  }, 60000);
}

// Un humano abandona (lobby) o se desconecta.
function endTournamentFor(playerId) {
  for (const [id, t] of tournaments.entries()) {
    const idx = t.humans.findIndex(h => h.id === playerId);
    if (idx === -1) continue;

    if (t.status === 'lobby') {
      t.humans.splice(idx, 1);
      if (t.humans.length === 0) {
        tournaments.delete(id);
      } else if (t.hostId === playerId) {
        t.hostId = t.humans[0].id; // promover nuevo anfitrión
      }
    }
    // En un torneo activo el humano se queda "abandonado": su sala de partida la
    // termina el bot vía el reloj de turno; el cuadro avanza igualmente.
  }
}

// Un socket se desconectó: en el LOBBY, quitar al humano fantasma; si era el
// anfitrión, promover a otro; si no queda nadie, borrar el torneo.
function handleDisconnect(io, socketId) {
  for (const [id, t] of tournaments.entries()) {
    const h = t.humans.find(x => x.socketId === socketId);
    if (!h) continue;
    if (t.status === 'lobby') {
      t.humans = t.humans.filter(x => x.socketId !== socketId);
      if (t.humans.length === 0) {
        tournaments.delete(id);
      } else {
        if (t.hostId === h.id) t.hostId = t.humans[0].id;
        emitState(io, t);
      }
    } else {
      // En activo, marcar el socket como caído; su partida la termina el reloj.
      h.socketId = null;
    }
  }
}

function getTournament(id) { return tournaments.get(id); }

module.exports = {
  tournaments,
  roomToTournament,
  createTournament,
  joinTournament,
  startTournament,
  onMatchEnd,
  endTournamentFor,
  handleDisconnect,
  getTournament,
  simulateBotMatch,
  emitState,
  publicState,
  REWARD,
  MATCH_MAX_SCORE
};
