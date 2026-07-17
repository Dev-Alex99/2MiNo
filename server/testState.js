// Verifica que el camino optimizado de difusión (getSharedState + shared) da
// EXACTAMENTE el mismo estado que el camino directo, y que la privacidad de las
// manos y poderes se respeta (incluida la revelación por espía).

const DominoGame = require('./gameLogic');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`✓ ${msg}`);
}

function runTests() {
  console.log('=== PRUEBAS DE ESTADO / PRIVACIDAD ===');

  const g = new DominoGame('STATE', null, { powersEnabled: true });
  g.addPlayer('p1', 'Ana', 's1');
  g.addPlayer('p2', 'Beto', 's2');
  g.addPlayer('p3', 'Caro', 's3');
  g.startNewGame();

  // Camino con shared == camino directo, jugador por jugador
  const shared = g.getSharedState();
  for (const pid of ['p1', 'p2', 'p3']) {
    const a = JSON.stringify(g.getGameStateForPlayer(pid, shared));
    const b = JSON.stringify(g.getGameStateForPlayer(pid));
    assert(a === b, `El estado con shared es idéntico al directo (${pid})`);
  }

  // Privacidad básica: cada quien ve su mano, los demás vacía
  const st1 = g.getGameStateForPlayer('p1', shared);
  const meP1 = st1.players.find(p => p.id === 'p1');
  const otherP1 = st1.players.find(p => p.id === 'p2');
  assert(meP1.hand.length === g.players[0].hand.length, 'Ana ve su propia mano');
  assert(otherP1.hand.length === 0, 'Ana NO ve la mano de Beto');
  assert(otherP1.powers.length === 0, 'Ana NO ve los poderes de Beto');

  // Revelación por espía: p1 espía a p2
  g.activeEffects.spyEyeTargetId = 'p2';
  g.activeEffects.spyEyeOwnerId = 'p1';
  g.activeEffects.spyEyeEndTime = Date.now() + 10000;
  const shared2 = g.getSharedState();

  const spyView = g.getGameStateForPlayer('p1', shared2);
  const spied = spyView.players.find(p => p.id === 'p2');
  assert(spied.hand.length > 0, 'El espía (Ana) SÍ ve la mano del espiado (Beto)');

  const nonSpyView = g.getGameStateForPlayer('p3', shared2);
  const notSpied = nonSpyView.players.find(p => p.id === 'p2');
  assert(notSpied.hand.length === 0, 'Quien no espía (Caro) NO ve la mano de Beto');

  // Al terminar la ronda, todos ven todas las manos
  g.activeEffects.spyEyeEndTime = 0;
  g.status = 'round_ended';
  const endShared = g.getSharedState();
  const endView = g.getGameStateForPlayer('p3', endShared);
  assert(endView.players.every(p => p.hand.length === g.players.find(x => x.id === p.id).hand.length),
    'Al terminar la ronda se revelan todas las manos');

  console.log('\n=== TODAS LAS PRUEBAS DE ESTADO PASARON ===');
}

try {
  runTests();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
