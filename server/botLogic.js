// IA de los bots. Funciones puras sobre el estado del juego: reciben la partida
// y devuelven qué hacer, sin tocar sockets ni temporizadores.

const BOT_NAMES = ['Rita', 'Chema', 'Yuri', 'Nando', 'Pilar', 'Bruno', 'Tere', 'Iván'];

const SAFE_BOT_POWERS = ['shield', 'double_shot', 'skip', 'freeze', 'wildcard'];

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

  let score = tile[0] + tile[1];
  if (isDouble) score += (difficulty === 'maestro' ? 12 : 6);

  if (difficulty === 'facil') return score;

  const openEnd = game.resultingEnd(player.id, move);
  if (openEnd === null) return score;

  const rivals = game.players.filter(p =>
    p.id !== player.id && (!game.teamsEnabled || p.team !== player.team)
  );
  const partners = game.teamsEnabled
    ? game.players.filter(p => p.id !== player.id && p.team === player.team)
    : [];

  const weightPass = difficulty === 'maestro' ? 22 : 14;

  // Bloquear: si un rival pasó sobre este extremo, dejárselo es de máxima prioridad.
  for (const opp of rivals) {
    const passedOn = game.playerPassedOn[opp.id] || [];
    if (passedOn.includes(openEnd)) score += weightPass;
  }

  // No ahogar al compañero
  for (const mate of partners) {
    const passedOn = game.playerPassedOn[mate.id] || [];
    if (passedOn.includes(openEnd)) score -= weightPass;
  }

  // Flexibilidad: mejor dejar expuesto un número del que tengo reserva en mano
  const rest = player.hand.filter((_, i) => i !== move.tileIndex);
  const countInHand = rest.filter(t => t[0] === openEnd || t[1] === openEnd).length;
  if (countInHand > 0) score += (difficulty === 'maestro' ? 8 * countInHand : 4);

  // IA Maestro: Conteo de Fichas en Tablero
  if (difficulty === 'maestro') {
    let playedCount = 0;
    (game.board || []).forEach(t => {
      if (t[0] === openEnd) playedCount++;
      if (t[1] === openEnd) playedCount++;
    });

    // Si ya salieron 5 o más fichas de este palo, el extremo está muy ahorcado (bloqueo táctico).
    if (playedCount >= 5) score += 20;

    // Si al bot le queda solo 1 o 2 fichas en mano, priorizar cierre directo.
    if (player.hand.length <= 2) score += 30;
  }

  return score;
}

function chooseMove(game, playerId) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return null;

  const moves = game.getValidMoves(playerId);
  if (moves.length === 0) return null;

  const difficulty = player.difficulty || 'normal';

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

function choosePower(game, playerId, random = Math.random) {
  const player = game.players.find(p => p.id === playerId);
  if (!player || !game.powersEnabled) return null;
  const diff = player.difficulty || 'normal';
  if (diff === 'facil') return null;
  if (!player.powers || player.powers.length === 0) return null;

  const usable = player.powers.filter(c => SAFE_BOT_POWERS.includes(c.id));
  if (usable.length === 0) return null;

  const threshold = diff === 'maestro' ? 0.6 : 0.3;
  if (random() > threshold) return null;

  return usable[Math.floor(random() * usable.length)].id;
}

module.exports = { chooseMove, choosePower, pickBotName, scoreMove, BOT_NAMES, SAFE_BOT_POWERS };
