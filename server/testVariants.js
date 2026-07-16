// Pruebas de las opciones de sala: variante (doble 6 / doble 9) y cartas de poder on/off.

const DominoGame = require('./gameLogic');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`✓ ${message}`);
}

function seat(game, n) {
  for (let i = 1; i <= n; i++) {
    game.addPlayer(`p${i}`, `Jugador${i}`, `socket${i}`);
  }
  game.startNewGame();
}

// Reconstruye el mazo completo a partir de manos + pozo + tablero
function allTiles(game) {
  const tiles = [...game.boneyard, ...game.board];
  game.players.forEach(p => tiles.push(...p.hand));
  return tiles;
}

function runTests() {
  console.log('=== PRUEBAS DE VARIANTES Y OPCIONES DE SALA ===');

  // --- 1. Compatibilidad hacia atrás ---
  const legacy = new DominoGame('LEGACY', 100);
  assert(legacy.maxPip === 6, 'Por defecto es doble 6');
  assert(legacy.handSize === 7, 'Por defecto reparte 7 fichas');
  assert(legacy.powersEnabled === true, 'Por defecto los poderes están activos');
  assert(legacy.maxScore === 100, 'Respeta el maxScore explícito (firma antigua)');

  // --- 2. Doble 6 ---
  const d6 = new DominoGame('D6', null, { maxPip: 6 });
  assert(d6.maxScore === 100, 'Doble 6 usa 100 pts por defecto');
  seat(d6, 3);
  assert(allTiles(d6).length === 28, 'Doble 6 genera 28 fichas');
  assert(d6.players.every(p => p.hand.length === 7), 'Doble 6 reparte 7 fichas a cada uno');
  assert(d6.boneyard.length === 28 - 21, 'Doble 6 con 3 jugadores deja 7 en el pozo');
  assert(allTiles(d6).every(t => t[0] <= 6 && t[1] <= 6), 'Doble 6 no contiene puntos > 6');

  // Doble 6 con 4 jugadores reparte el mazo entero
  const d6full = new DominoGame('D6FULL', null, { maxPip: 6 });
  seat(d6full, 4);
  assert(d6full.boneyard.length === 0, 'Doble 6 con 4 jugadores deja el pozo vacío (28 = 4×7)');

  // --- 3. Doble 9 ---
  const d9 = new DominoGame('D9', null, { maxPip: 9 });
  assert(d9.maxPip === 9, 'Se configura la variante doble 9');
  assert(d9.handSize === 10, 'Doble 9 reparte 10 fichas');
  assert(d9.maxScore === 200, 'Doble 9 usa 200 pts por defecto');
  seat(d9, 4);
  const d9tiles = allTiles(d9);
  assert(d9tiles.length === 55, 'Doble 9 genera 55 fichas');
  assert(d9.players.every(p => p.hand.length === 10), 'Doble 9 reparte 10 fichas a cada uno');
  assert(d9.boneyard.length === 55 - 40, 'Doble 9 con 4 jugadores deja 15 en el pozo');
  assert(d9tiles.some(t => t[0] === 9 || t[1] === 9), 'Doble 9 incluye fichas con 9 puntos');
  assert(d9tiles.every(t => t[0] <= 9 && t[1] <= 9), 'Doble 9 no excede los 9 puntos');

  // Sin fichas duplicadas y con todas las combinaciones
  const keys = new Set(d9tiles.map(t => `${Math.min(t[0], t[1])}-${Math.max(t[0], t[1])}`));
  assert(keys.size === 55, 'Doble 9: las 55 fichas son únicas (sin duplicados)');

  // --- 4. Poderes desactivados (dominó clásico) ---
  const classic = new DominoGame('CLASSIC', null, { powersEnabled: false });
  assert(classic.powersEnabled === false, 'La sala queda en modo clásico');
  seat(classic, 3);
  assert(classic.players.every(p => p.powers.length === 0), 'Nadie recibe cartas de poder');
  assert(classic.powerDeck.length === 0, 'No se genera mazo de poderes');

  const denied = classic.usePowerCard('p1', 'shield', null, null);
  assert(denied.success === false, 'usePowerCard se rechaza en modo clásico');
  assert(/clásico/i.test(denied.error), `El error explica el motivo: "${denied.error}"`);

  // El estado enviado al cliente refleja la configuración
  const state = classic.getGameStateForPlayer('p1');
  assert(state.powersEnabled === false, 'El estado expone powersEnabled=false');
  assert(state.maxPip === 6, 'El estado expone maxPip');

  // --- 5. Poderes activos siguen funcionando ---
  const withPowers = new DominoGame('POWERS', null, { powersEnabled: true, maxPip: 9 });
  seat(withPowers, 2);
  assert(withPowers.players.every(p => p.powers.length === 2), 'Con poderes se reparten 2 cartas por jugador');
  assert(withPowers.getGameStateForPlayer('p1').powersEnabled === true, 'El estado expone powersEnabled=true');

  // --- 6. maxPip inválido cae a 6 ---
  const bogus = new DominoGame('BOGUS', null, { maxPip: 12 });
  assert(bogus.maxPip === 6, 'Un maxPip no soportado cae a doble 6');

  // --- 7. Se puede jugar una ronda completa en doble 9 ---
  const play = new DominoGame('PLAY9', null, { maxPip: 9, powersEnabled: false });
  seat(play, 2);
  const starter = play.players[play.currentPlayerIndex];
  const res = play.playTile(starter.id, 0, 'left');
  assert(res.success === true, 'Doble 9: se juega la primera ficha en el tablero vacío');
  assert(play.board.length === 1, 'Doble 9: la ficha queda en el tablero');

  console.log('\n=== TODAS LAS PRUEBAS DE VARIANTES PASARON ===');
}

try {
  runTests();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
