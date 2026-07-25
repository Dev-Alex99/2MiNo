// M3 — Falsa tranca por efectos temporales.
// Regla acordada: un pase provocado ÚNICAMENTE por un efecto temporal
// (Congelar Extremo / Bloqueo Total / Maldición) NO declara bloqueo: el tablero
// no está cerrado, solo bloqueado un instante.
const assert = require('assert');
const DominoGame = require('./gameLogic');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

// Partida de 2 jugadores con el pozo vacío (para que pasar sea legal) y un
// tablero controlado: extremos 3 (izq) y 5 (der).
function scenario() {
  const g = new DominoGame('T', null, { powersEnabled: true, maxPip: 6, drawEnabled: false });
  g.addPlayer('p1', 'Uno', 's1');
  g.addPlayer('p2', 'Dos', 's2');
  g.players.forEach(p => { p.ready = true; });
  g.startNewGame();

  g.board = [[3, 4], [4, 5]];       // extremos: izquierda=3, derecha=5
  g.boneyard = [];
  g.status = 'playing';
  g.passedTurns = 0;
  g.playerPassedOn = {};
  return g;
}

// ─── 1. Pase por extremo congelado: NO cuenta ni declara tranca ───
(() => {
  const g = scenario();
  const [p1, p2] = g.players;

  // p1 SÍ tiene jugada (un 5 para el extremo derecho), pero está congelado.
  p1.hand = [[5, 6]];
  p2.hand = [[0, 1]]; // p2 no puede jugar de ningún modo
  g.currentPlayerIndex = 0;

  // Congelar AMBOS extremos para p1 (dueño del efecto: p2).
  g.activeEffects.frozenEnd = 'both';
  g.activeEffects.frozenEndOwnerId = p2.id;

  ok(!g.hasValidMove(p1.id), 'con el extremo congelado, p1 no puede jugar');
  ok(g.hasValidMove(p1.id, { ignoreBlocks: true }), 'p1 SÍ podría jugar si no estuviera congelado');
  ok(g.passForcedByEffectsOnly(p1.id), 'el pase de p1 se identifica como provocado por el efecto');

  const before = g.passedTurns;
  const res = g.passTurn(p1.id);
  ok(res.success, 'p1 puede pasar (pozo vacío)');
  ok(g.passedTurns === before, `el pase por efecto NO incrementa el contador de tranca (sigue en ${g.passedTurns})`);
  ok(g.status === 'playing', 'la ronda continúa: no se declara tranca por un bloqueo temporal');
  ok(!g.playerPassedOn[p1.id], 'no se registra info falsa para los bots (p1 sí tenía el extremo)');
})();

// ─── 2. Pase genuino (mano muerta): SÍ cuenta ───
(() => {
  const g = scenario();
  const [p1, p2] = g.players;
  p1.hand = [[0, 1]];  // no casa con 3 ni con 5
  p2.hand = [[0, 2]];
  g.currentPlayerIndex = 0;

  ok(!g.passForcedByEffectsOnly(p1.id), 'un pase con la mano muerta NO se atribuye a un efecto');
  g.passTurn(p1.id);
  ok(g.passedTurns === 1, 'el pase genuino SÍ incrementa el contador de tranca');
  ok(Array.isArray(g.playerPassedOn[p1.id]), 'el pase genuino sí registra info pública para los bots');
})();

// ─── 3. Tranca real: sigue detectándose ───
(() => {
  const g = scenario();
  const [p1, p2] = g.players;
  p1.hand = [[0, 1]];  // ninguno casa con 3 ni 5
  p2.hand = [[0, 2]];
  g.currentPlayerIndex = 0;

  g.passTurn(p1.id);
  g.passTurn(p2.id);
  ok(g.status === 'round_ended', 'una tranca REAL (nadie puede jugar) sigue cerrando la ronda');
})();

// ─── 4. El contador no cierra la ronda si alguien puede jugar (defensa) ───
(() => {
  const g = scenario();
  const [p1] = g.players;
  p1.hand = [[5, 6]];               // p1 tiene jugada real en el extremo derecho
  g.players[1].hand = [[0, 1]];
  g.passedTurns = g.players.length; // contador ya en el umbral

  g.checkRoundEnd();
  ok(g.status === 'playing', 'checkRoundEnd no declara tranca si alguien tiene jugada legal');
  ok(g.passedTurns === 0, 'el contador se reinicia tras la falsa alarma');
})();

console.log(`\n=== TODAS LAS PRUEBAS DE FALSA TRANCA PASARON (${passed}) ===`);
