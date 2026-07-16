// Pruebas de la jugada obligada por tiempo (forceTurn) y de findValidMove.
// Es la lógica que evita que una mesa se quede colgada si alguien no juega.

const DominoGame = require('./gameLogic');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`✓ ${message}`);
}

function makeGame(opts = {}) {
  const game = new DominoGame('TIMER', null, { powersEnabled: false, ...opts });
  game.addPlayer('p1', 'Ana', 's1');
  game.addPlayer('p2', 'Beto', 's2');
  game.startNewGame();
  return game;
}

// Coloca al juego en un estado controlado: manos y tablero fijados a mano.
function setup(game, { hands, board = [], boneyard = [], turn = 0 }) {
  game.players.forEach((p, i) => { p.hand = hands[i].map(t => [...t]); });
  game.board = board.map(t => [...t]);
  game.boneyard = boneyard.map(t => [...t]);
  game.currentPlayerIndex = turn;
  game.status = 'playing';
  game.passedTurns = 0;
}

function runTests() {
  console.log('=== PRUEBAS DEL RELOJ DE TURNO ===');

  // --- findValidMove ---
  {
    const g = makeGame();
    setup(g, { hands: [[[6, 6], [3, 4]], [[1, 1]]], board: [[2, 3], [3, 5]] });
    // extremos: izq=2, der=5. La [3,4] no pega; la [6,6] tampoco. Ninguna jugada.
    assert(g.findValidMove('p1') === null, 'findValidMove: devuelve null sin jugadas legales');

    setup(g, { hands: [[[6, 6], [5, 4]], [[1, 1]]], board: [[2, 3], [3, 5]] });
    const m = g.findValidMove('p1');
    assert(m && m.tileIndex === 1 && m.side === 'right', 'findValidMove: encuentra la ficha que pega por la derecha');

    setup(g, { hands: [[[2, 0]], [[1, 1]]], board: [[2, 3], [3, 5]] });
    const ml = g.findValidMove('p1');
    assert(ml && ml.side === 'left', 'findValidMove: encuentra la que pega por la izquierda');

    // Tablero vacío: cualquier ficha sirve
    setup(g, { hands: [[[6, 4]], [[1, 1]]], board: [] });
    assert(g.findValidMove('p1').tileIndex === 0, 'findValidMove: con tablero vacío vale la primera ficha');
  }

  // --- Extremo congelado ---
  {
    const g = makeGame({ powersEnabled: true });
    setup(g, { hands: [[[2, 0]], [[1, 1]]], board: [[2, 3], [3, 5]] });
    g.activeEffects.frozenEnd = 'left';
    g.activeEffects.frozenEndOwnerId = 'p2'; // congelado por el rival => p1 no puede
    assert(g.findValidMove('p1') === null, 'findValidMove: respeta el extremo congelado por un rival');

    g.activeEffects.frozenEndOwnerId = 'p1'; // lo congeló él mismo => sí puede
    assert(g.findValidMove('p1') !== null, 'findValidMove: el dueño del congelamiento sí puede jugar ahí');
  }

  // --- forceTurn: juega si tiene jugada ---
  {
    const g = makeGame();
    setup(g, { hands: [[[6, 6], [5, 4]], [[1, 1]]], board: [[2, 3], [3, 5]] });
    const r = g.forceTurn();
    assert(r.action === 'played', 'forceTurn: juega automáticamente si hay jugada legal');
    assert(g.board.length === 3, 'forceTurn: la ficha entró en el tablero');
    assert(g.getRightEnd() === 4, 'forceTurn: el extremo derecho se actualizó a 4');
    assert(g.currentPlayerIndex === 1, 'forceTurn: el turno pasó al siguiente jugador');
  }

  // --- forceTurn: roba del pozo hasta poder jugar ---
  {
    const g = makeGame();
    setup(g, {
      hands: [[[6, 6]], [[1, 1]]],
      board: [[2, 3], [3, 5]],
      boneyard: [[0, 0], [5, 1]] // se roba desde el final: primero [5,1], que ya pega
    });
    const r = g.forceTurn();
    assert(r.action === 'played', 'forceTurn: roba y juega cuando empieza sin jugada');
    assert(r.drew === 1, `forceTurn: robó exactamente 1 ficha (robó ${r.drew})`);
    assert(g.boneyard.length === 1, 'forceTurn: el pozo bajó a 1');
  }

  // --- forceTurn: pasa si no hay jugada ni pozo ---
  {
    const g = makeGame();
    setup(g, { hands: [[[6, 6]], [[1, 1]]], board: [[2, 3], [3, 5]], boneyard: [] });
    const r = g.forceTurn();
    assert(r.action === 'passed', 'forceTurn: pasa turno si no hay jugada ni pozo');
    assert(g.passedTurns === 1, 'forceTurn: el pase quedó contabilizado');
  }

  // --- forceTurn: nunca deja la mesa sin avanzar ---
  {
    const g = makeGame();
    setup(g, { hands: [[[6, 6]], [[1, 1]]], board: [[2, 3], [3, 5]], boneyard: [] });
    const before = g.currentPlayerIndex;
    g.forceTurn();
    assert(g.currentPlayerIndex !== before, 'forceTurn: el turno SIEMPRE avanza (no se cuelga la mesa)');
  }

  // --- forceTurn: no hace nada si la partida no está en curso ---
  {
    const g = makeGame();
    g.status = 'round_ended';
    assert(g.forceTurn().action === 'none', 'forceTurn: se ignora si la ronda ya terminó');
  }

  // --- forceTurn puede cerrar la ronda (dominó) ---
  {
    const g = makeGame();
    setup(g, { hands: [[[5, 4]], [[1, 1]]], board: [[2, 3], [3, 5]] });
    const r = g.forceTurn();
    assert(r.action === 'played', 'forceTurn: juega su última ficha');
    assert(g.status === 'round_ended', 'forceTurn: cerrar la mano termina la ronda correctamente');
    assert(g.roundWinner === 'p1', 'forceTurn: se reconoce al ganador de la ronda');
  }

  // --- El estado expone el reloj ---
  {
    const g = makeGame();
    g.turnEndsAt = Date.now() + 30000;
    const st = g.getGameStateForPlayer('p1');
    assert(st.turnDurationSeconds === 30, 'El estado expone la duración del turno');
    assert(st.turnSecondsRemaining > 28 && st.turnSecondsRemaining <= 30,
      `El estado expone los segundos restantes (${st.turnSecondsRemaining})`);

    g.status = 'round_ended';
    assert(g.getGameStateForPlayer('p1').turnSecondsRemaining === null,
      'Sin partida en curso no se envía cuenta atrás');
  }

  console.log('\n=== TODAS LAS PRUEBAS DEL RELOJ PASARON ===');
}

try {
  runTests();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
