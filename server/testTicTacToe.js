const GameRegistry = require('./core/GameRegistry');
require('./games/TicTacToeGame');
const assert = require('assert');

console.log('=== PRUEBAS UNITARIAS DE TRES EN RAYA (TIC-TAC-TOE) ===');

// 1. Registro en GameRegistry
const entry = GameRegistry.get('tictactoe');
assert(entry !== null, 'TicTacToeGame debe estar registrado en GameRegistry');
assert.strictEqual(entry.metadata.name, 'Tres en Raya');
console.log('✓ Registro en GameRegistry verificado');

// 2. Creación e inicio de partida
const game = GameRegistry.createGameInstance('tictactoe', 'room_test_1', {});
game.addPlayer('p1', 'Alice');
game.addPlayer('p2', 'Bob');
assert.strictEqual(game.players.length, 2);

const started = game.startNewGame();
assert.strictEqual(started, true);
assert.strictEqual(game.status, 'playing');
assert.strictEqual(game.symbols['p1'], 'X');
assert.strictEqual(game.symbols['p2'], 'O');
console.log('✓ Inicio de partida 1v1 y asignación de símbolos X/O OK');

// 3. Simulación de jugadas hasta victoria de X
// Tablero:
// X | O | .
// X | O | .
// X | . | .  -> Gana X en la columna 0 (0, 3, 6)
game.handleAction('p1', 'move', { index: 0 }); // X en 0
game.handleAction('p2', 'move', { index: 1 }); // O en 1
game.handleAction('p1', 'move', { index: 3 }); // X en 3
game.handleAction('p2', 'move', { index: 4 }); // O en 4
const winAction = game.handleAction('p1', 'move', { index: 6 }); // X en 6 -> Victoria

assert.strictEqual(winAction.success, true);
assert.strictEqual(game.status, 'game_ended');
assert.strictEqual(game.winner, 'X');
assert.deepStrictEqual(game.winningLine, [0, 3, 6]);
assert.strictEqual(game.scores.X, 1);
console.log('✓ Victoria de X detectada correctamente con línea [0, 3, 6]');

// 4. Prueba de Bot IA
const botGame = GameRegistry.createGameInstance('tictactoe', 'room_test_bot', {});
botGame.addPlayer('p1', 'Alice');
const bot = botGame.addBot('Bot TresEnRaya', 'normal');
assert(bot !== null, 'Se debe añadir el bot correctamente');
assert.strictEqual(botGame.players.length, 2);
console.log('✓ Creación e integración de Bot IA OK');

console.log('=== TODAS LAS PRUEBAS DE TRES EN RAYA PASARON CORRECTAMENTE ===');
