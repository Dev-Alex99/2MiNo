const assert = require('assert');
const DominoGame = require('./gameLogic');

console.log('=== PRUEBAS DE CAPICÚA EN DOMINÓ ===');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log(`✓ ${msg}`);
  passed++;
}

// 1. Detección de Capicúa en modo individual: extremos [4, 2], última ficha [4, 2]
(() => {
  const g = new DominoGame('CAP1', 100, { powersEnabled: false, teamsEnabled: false });
  g.addPlayer('p1', 'Jugador 1', 's1');
  g.addPlayer('p2', 'Jugador 2', 's2');
  g.startNewRound();

  // Tablero con extremos 4 a la izquierda y 2 a la derecha: [4, 0] y [0, 2]
  g.board = [[4, 0], [0, 2]];
  // p1 tiene una sola ficha: [4, 2]
  g.players[0].hand = [[4, 2]];
  // p2 tiene [6, 6] (12 puntos)
  g.players[1].hand = [[6, 6]];
  g.currentPlayerIndex = 0;

  // p1 juega su ficha al extremo derecho (o izquierdo)
  const res = g.playTile('p1', 0, 'right');
  ok(res.success, 'jugada legal de la última ficha');
  ok(g.status === 'round_ended', 'la ronda termina por mano vacía');
  ok(g.roundWinner === 'p1', 'el ganador de la ronda es p1');
  ok(g.lastRoundCapicua === true, 'se detecta como Capicúa reglamentaria');
  // p2 tenía 12 puntos en mano: con Capicúa deben ser 12 * 2 = 24 puntos
  ok(g.players[0].score === 24, `puntuación duplicada por Capicúa (12 x 2 = 24, actual: ${g.players[0].score})`);
  ok(g.getSharedState().isCapicua === true, 'getSharedState expone isCapicua: true');

  // Al arrancar nueva ronda, debe resetearse
  g.startNewRound();
  ok(g.lastRoundCapicua === false, 'lastRoundCapicua se resetea al iniciar nueva ronda');
  ok(g.getSharedState().isCapicua === false, 'getSharedState expone isCapicua: false en nueva ronda');
})();

// 2. No es Capicúa si la última ficha es un doble
(() => {
  const g = new DominoGame('CAP2', 100, { powersEnabled: false, teamsEnabled: false });
  g.addPlayer('p1', 'Jugador 1', 's1');
  g.addPlayer('p2', 'Jugador 2', 's2');
  g.startNewRound();

  // Tablero con extremos 3 y 5
  g.board = [[3, 1], [1, 5]];
  // p1 cierra con doble 5: [5, 5]
  g.players[0].hand = [[5, 5]];
  g.players[1].hand = [[1, 2]]; // 3 puntos
  g.currentPlayerIndex = 0;

  const res = g.playTile('p1', 0, 'right');
  ok(res.success, 'jugada legal con doble');
  ok(g.status === 'round_ended', 'la ronda termina');
  ok(g.lastRoundCapicua === false, 'un doble NO es Capicúa según regla clásica');
  ok(g.players[0].score === 3, 'puntuación normal sin duplicar (3 puntos)');
})();

// 3. No es Capicúa si los extremos son iguales (e.g. 4 y 4) y la ficha solo calza con ese número
(() => {
  const g = new DominoGame('CAP3', 100, { powersEnabled: false, teamsEnabled: false });
  g.addPlayer('p1', 'Jugador 1', 's1');
  g.addPlayer('p2', 'Jugador 2', 's2');
  g.startNewRound();

  // Extremos 4 y 4
  g.board = [[4, 1], [1, 4]];
  // p1 tiene [4, 6] -> solo coincide con el 4, no con ambos extremos distintos
  g.players[0].hand = [[4, 6]];
  g.players[1].hand = [[2, 2]]; // 4 puntos
  g.currentPlayerIndex = 0;

  const res = g.playTile('p1', 0, 'right');
  ok(res.success, 'jugada legal');
  ok(g.lastRoundCapicua === false, 'no es Capicúa si ambos extremos eran el mismo número');
  ok(g.players[0].score === 4, 'puntos normales (4)');
})();

// 4. Capicúa en Parejas (2v2): duplica la suma de las manos rivales
(() => {
  const g = new DominoGame('CAP4', 100, { powersEnabled: false, teamsEnabled: true });
  g.addPlayer('p1', 'A1', 's1');
  g.addPlayer('p2', 'B1', 's2');
  g.addPlayer('p3', 'A2', 's3');
  g.addPlayer('p4', 'B2', 's4');
  g.assignTeams();
  g.startNewRound();

  // Extremos 6 y 1
  g.board = [[6, 3], [3, 1]];
  // p1 (Equipo 0) tiene [6, 1]
  g.players[0].hand = [[6, 1]];
  g.players[2].hand = [[0, 1]]; // p3 compañero (Equipo 0)
  // Rivales: Equipo 1
  g.players[1].hand = [[2, 3]]; // 5 pts
  g.players[3].hand = [[4, 1]]; // 5 pts (total rival = 10 pts)
  g.currentPlayerIndex = 0;

  const res = g.playTile('p1', 0, 'left');
  ok(res.success, 'jugada legal de cierre');
  ok(g.lastRoundCapicua === true, 'Capicúa en 2v2 detectada');
  // Rivales sumaban 10 puntos -> con Capicúa el equipo 0 debe recibir 20 puntos
  ok(g.teamScores[0] === 20, `equipo ganador recibe puntuación doble en 2v2 (10 x 2 = 20, actual: ${g.teamScores[0]})`);
})();

console.log(`=== TODAS LAS PRUEBAS DE CAPICÚA PASARON (${passed}) ===`);
