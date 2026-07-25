// Regresiones del motor corregidas en la auditoría (M1, M2, M4).
// Cada bloque falla si se revierte el arreglo correspondiente.
const assert = require('assert');
const DominoGame = require('./gameLogic');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

function newGame(opts = {}) {
  const g = new DominoGame('TEST', null, { powersEnabled: true, maxPip: 6, drawEnabled: true, ...opts });
  g.addPlayer('p1', 'Uno', 's1');
  g.addPlayer('p2', 'Dos', 's2');
  g.players.forEach(p => { p.ready = true; });
  return g;
}

// ─── M4: una sola fuente para activeEffects (resetGame ya no deja undefined) ───
(() => {
  const g = newGame();
  g.startNewGame();
  const keys = Object.keys(g.activeEffects).sort();

  g.resetGame();
  const afterReset = Object.keys(g.activeEffects).sort();
  assert.deepStrictEqual(afterReset, keys, 'resetGame debe producir las mismas claves que el constructor');
  ok(true, 'M4: resetGame inicializa TODAS las claves de activeEffects (sin undefined)');

  // Los campos que antes faltaban en resetGame deben existir y ser null/0, no undefined.
  for (const k of ['spyAllOwnerId', 'cursedPlayerId', 'cursedSide']) {
    ok(g.activeEffects[k] === null, `M4: activeEffects.${k} es null tras resetGame (antes: undefined)`);
  }
  ok(g.activeEffects.spyAllEndTime === 0, 'M4: activeEffects.spyAllEndTime es 0 tras resetGame');
})();

// ─── M1: startNewGame/startNewRound limpian los ganadores previos ───
(() => {
  const g = newGame();
  g.startNewGame();

  // Simular partida terminada.
  g.status = 'game_ended';
  g.gameWinner = 'p1';
  g.roundWinner = 'p1';

  g.startNewGame(); // equivalente a 'play_again'
  ok(g.gameWinner === null, 'M1: startNewGame limpia gameWinner (sin banner de ganador fantasma)');
  ok(g.roundWinner === null, 'M1: startNewGame limpia roundWinner');
  ok(g.getSharedState().gameWinner === null, 'M1: el estado difundido ya no lleva el ganador anterior');
})();

(() => {
  const g = newGame({ teamsEnabled: true });
  g.addPlayer('p3', 'Tres', 's3');
  g.addPlayer('p4', 'Cuatro', 's4');
  g.players.forEach(p => { p.ready = true; });
  g.startNewGame();

  g.roundWinnerTeam = 1; // ronda anterior ganada por el equipo B
  g.startNewRound();
  ok(g.roundWinnerTeam === null, 'M1: startNewRound limpia roundWinnerTeam (parejas)');
})();

// ─── M2: usePowerCard revalida el fin de ronda ───
(() => {
  const g = newGame();
  g.startNewGame();

  const cur = g.players[g.currentPlayerIndex];
  const other = g.players.find(p => p.id !== cur.id);

  // Dejar al jugador en turno con UNA sola ficha y darle Contrabando.
  cur.hand = [[6, 6]];
  cur.powers = [{ id: 'smuggle' }];
  g.powerUsedThisTurn = false;

  // Regalar su última ficha: la mano queda vacía ⇒ debe resolverse la ronda.
  const res = g.usePowerCard(cur.id, 'smuggle', other.id, 0);
  ok(res.success, 'M2: el poder Contrabando se aplica correctamente');
  ok(cur.hand.length === 0, 'M2: la mano del jugador queda vacía tras regalar su última ficha');
  ok(
    g.status !== 'playing',
    `M2: la ronda se resuelve tras quedarse sin fichas por un poder (status=${g.status}, antes se quedaba colgada en 'playing')`
  );
})();

console.log(`\n=== TODAS LAS PRUEBAS DE REGRESIÓN DEL MOTOR PASARON (${passed}) ===`);
