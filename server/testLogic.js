// Script de prueba rápida para validar la lógica del juego de Dominó.
// Ejecuta un flujo simulado para asegurar que las reglas y transiciones funcionan.

const DominoGame = require('./gameLogic');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`✓ ${message}`);
}

function runTests() {
  console.log("=== INICIANDO PRUEBAS DE LÓGICA DE JUEGO ===");

  const game = new DominoGame('TEST', 100);

  // 1. Agregar jugadores
  const p1 = game.addPlayer('p1', 'Alejandro', 'socket1');
  const p2 = game.addPlayer('p2', 'Sofía', 'socket2');
  const p3 = game.addPlayer('p3', 'Carlos', 'socket3');
  
  assert(game.players.length === 3, 'Se agregaron 3 jugadores correctamente');
  assert(p1.name === 'Alejandro', 'Jugador 1 se llama Alejandro');

  // 2. Estado inicial de "Listo"
  game.toggleReady('socket1');
  game.toggleReady('socket2');
  assert(p1.ready === true, 'Jugador 1 está Listo');
  assert(game.allReady() === false, 'Aún no están todos listos (falta p3)');
  
  game.toggleReady('socket3');
  assert(game.allReady() === true, 'Todos los jugadores están listos');

  // 3. Iniciar juego y ronda
  game.startNewGame();
  assert(game.status === 'playing', 'El juego comenzó y el estado es playing');
  assert(game.players.every(p => p.hand.length === 7), 'Cada jugador tiene 7 fichas');
  assert(game.boneyard.length === 7, 'El pozo contiene 7 fichas (28 - 3*7 = 7)');
  console.log('Fichas repartidas correctamente.');

  // 4. Probar extremos del tablero vacío
  assert(game.getLeftEnd() === null, 'Extremo izquierdo vacío inicialmente');
  assert(game.getRightEnd() === null, 'Extremo derecho vacío inicialmente');

  // Guardamos quién es el jugador activo actual
  const starterIndex = game.currentPlayerIndex;
  const starter = game.players[starterIndex];
  console.log(`El jugador que inicia es ${starter.name} con índice ${starterIndex}`);

  // Simular la colocación de la primera ficha
  const tileToPlay = [...starter.hand[0]];
  const resPlay1 = game.playTile(starter.id, 0, 'left');
  assert(resPlay1.success === true, `El jugador ${starter.name} colocó la primera ficha ${JSON.stringify(tileToPlay)}`);
  assert(game.board.length === 1, 'Hay 1 ficha en el tablero');
  assert(game.getLeftEnd() === tileToPlay[0], 'Extremo izquierdo configurado correctamente');
  assert(game.getRightEnd() === tileToPlay[1], 'Extremo derecho configurado correctamente');

  // Verificar que el turno avanzó
  assert(game.currentPlayerIndex === (starterIndex + 1) % 3, 'El turno avanzó al siguiente jugador');

  // 5. Validar movimientos válidos e inválidos
  const nextPlayer = game.players[game.currentPlayerIndex];
  
  // Agregar una ficha no coincidente temporalmente a su mano para probar movimiento inválido
  nextPlayer.hand.push([9, 9]); // Ficha imposible de jugar
  const invalidTileIndex = nextPlayer.hand.length - 1;
  const resPlayInvalid = game.playTile(nextPlayer.id, invalidTileIndex, 'left');
  assert(resPlayInvalid.success === false, 'Se denegó una jugada inválida correctamente');
  
  // Limpiar ficha de prueba
  nextPlayer.hand.pop();

  console.log("=== PRUEBAS COMPLETADAS CON ÉXITO ===");
}

try {
  runTests();
} catch (error) {
  console.error("❌ ERROR EN LAS PRUEBAS:", error.message);
  process.exit(1);
}
