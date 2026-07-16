// IA de los bots. Funciones puras sobre el estado del juego: reciben la partida
// y devuelven qué hacer, sin tocar sockets ni temporizadores. Así se puede
// probar la estrategia sin levantar un servidor.

const BOT_NAMES = ['Rita', 'Chema', 'Yuri', 'Nando', 'Pilar', 'Bruno', 'Tere', 'Iván'];

// Poderes que un bot puede usar sin elegir objetivo: se benefician solos y no
// pueden fallar por una selección inválida.
const SAFE_BOT_POWERS = ['shield', 'double_shot'];

function pickBotName(takenNames) {
  const taken = new Set(takenNames.map(n => n.toLowerCase()));
  const free = BOT_NAMES.filter(n => !taken.has(n.toLowerCase()));
  const pool = free.length ? free : BOT_NAMES;
  const base = pool[Math.floor(Math.random() * pool.length)];
  return free.length ? base : `${base} ${Math.floor(Math.random() * 90) + 10}`;
}

// Puntúa una jugada. Más alto = mejor.
function scoreMove(game, player, move, difficulty) {
  const tile = player.hand[move.tileIndex];
  if (!tile) return -Infinity;

  const isDouble = tile[0] === tile[1];

  // Base común: soltar cuanto antes las fichas que más puntos cuestan si te
  // quedas con ellas, y los dobles, que son los más difíciles de colocar.
  let score = tile[0] + tile[1];
  if (isDouble) score += 6;

  if (difficulty !== 'dificil') return score;

  const openEnd = game.resultingEnd(player.id, move);
  if (openEnd === null) return score;

  // Bloquear: si un rival ya pasó sobre ese número, dejárselo otra vez es oro.
  const opponents = game.players.filter(p => p.id !== player.id);
  for (const opp of opponents) {
    const passedOn = game.playerPassedOn[opp.id] || [];
    if (passedOn.includes(openEnd)) score += 14;
  }

  // Flexibilidad: mejor dejar expuesto un número que yo todavía pueda servir.
  const rest = player.hand.filter((_, i) => i !== move.tileIndex);
  if (rest.some(t => t[0] === openEnd || t[1] === openEnd)) score += 4;

  return score;
}

// Elige la jugada del bot, o null si no tiene ninguna legal.
function chooseMove(game, playerId) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return null;

  const moves = game.getValidMoves(playerId);
  if (moves.length === 0) return null;

  const difficulty = player.difficulty || 'normal';

  // Fácil: cualquier jugada legal. Se equivoca, y de eso se trata.
  if (difficulty === 'facil') {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const s = scoreMove(game, player, move, difficulty);
    if (s > bestScore) {
      bestScore = s;
      best = move;
    }
  }
  return best;
}

// Elige un poder sin objetivo que al bot le convenga usar ahora, o null.
// Los bots fáciles no usan poderes.
function choosePower(game, playerId, random = Math.random) {
  const player = game.players.find(p => p.id === playerId);
  if (!player || !game.powersEnabled) return null;
  if ((player.difficulty || 'normal') === 'facil') return null;
  if (!player.powers || player.powers.length === 0) return null;

  const usable = player.powers.filter(c => SAFE_BOT_POWERS.includes(c.id));
  if (usable.length === 0) return null;

  // No en todos los turnos: si los gastara siempre, resultaría mecánico.
  if (random() > 0.3) return null;

  return usable[Math.floor(random() * usable.length)].id;
}

module.exports = { chooseMove, choosePower, pickBotName, scoreMove, BOT_NAMES, SAFE_BOT_POWERS };
