// Script de prueba para validar la lógica del sistema de Cartas de Poderes.
const DominoGame = require('./gameLogic');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`✓ ${message}`);
}

function runPowerTests() {
  console.log("=== INICIANDO PRUEBAS DEL SISTEMA DE PODERES ===");

  const game = new DominoGame('POWER_TEST', 100);

  // 1. Agregar y alistar 3 jugadores
  const p1 = game.addPlayer('p1', 'Alejandro', 'socket1');
  const p2 = game.addPlayer('p2', 'Sofía', 'socket2');
  const p3 = game.addPlayer('p3', 'Carlos', 'socket3');
  
  game.toggleReady('socket1');
  game.toggleReady('socket2');
  game.toggleReady('socket3');
  
  // 2. Iniciar juego y comprobar reparto de cartas
  game.startNewGame();
  assert(p1.powers.length === 2 && p2.powers.length === 2 && p3.powers.length === 2, 
    'Cada jugador recibe exactamente 2 cartas de poder al iniciar la ronda');

  // Asegurar que el mazo de poderes tiene las cartas restantes
  assert(game.powerDeck.length === 26, 'El mazo de poderes contiene las 26 cartas restantes (32 - 3*2)');

  // 3. Probar uso de poder fuera de turno
  const activeIdx = game.currentPlayerIndex;
  const activePlayer = game.players[activeIdx];
  const inactivePlayer = game.players[(activeIdx + 1) % 3];

  // Forzar una carta en su mano
  inactivePlayer.powers = [{ id: 'shield', name: 'Escudo', type: 'defense' }];
  const useResInactive = game.usePowerCard(inactivePlayer.id, 'shield');
  assert(useResInactive.success === false, 'Se deniega usar poderes si no es tu turno');

  // 4. Probar poder de Escudo de Neón
  activePlayer.powers = [{ id: 'shield', name: 'Escudo', type: 'defense' }];
  const useResShield = game.usePowerCard(activePlayer.id, 'shield');
  assert(useResShield.success === true, 'El jugador activo usa Escudo correctamente');
  assert(activePlayer.shieldActive === true, 'El escudo del jugador activo ahora está activado');
  assert(activePlayer.powers.length === 0, 'La carta de poder fue consumida');

  // El escudo debe desactivarse cuando el turno vuelve al jugador
  game.nextTurn(); // Siguiente
  game.nextTurn(); // Siguiente
  game.nextTurn(); // Vuelve a activePlayer
  assert(activePlayer.shieldActive === false, 'El escudo expira al iniciar su siguiente turno');

  // 5. Probar Salto de Turno (Skip)
  // Forzar turno a Alejandro
  game.currentPlayerIndex = 0; // p1 (Alejandro)
  p1.powers = [{ id: 'skip', name: 'Salto', type: 'attack' }];
  
  // Siguiente jugador normal sería p2. Al usar skip, se marca el flag
  const resSkip = game.usePowerCard(p1.id, 'skip');
  assert(resSkip.success === true, 'Alejandro usa Salto de Turno');
  assert(game.activeEffects.skipNextTurn === true, 'Se marcó el flag de skipNextTurn');
  
  // Alejandro termina su turno (avanza)
  game.nextTurn();
  // p2 es saltado, el turno ahora apunta a Carlos (p3)!
  assert(game.currentPlayerIndex === 2, 'El turno saltó a Carlos (p3) exitosamente tras avanzar');

  // 6. Probar Sentido Contrario (Reverse)
  game.currentPlayerIndex = 1; // p2 (Sofía)
  p2.powers = [{ id: 'reverse', name: 'Reversa', type: 'buff' }];
  assert(game.activeEffects.reversed === false, 'Inicialmente el juego fluye normal');
  
  const resReverse = game.usePowerCard(p2.id, 'reverse');
  assert(resReverse.success === true, 'Sofía usa Sentido Contrario');
  assert(game.activeEffects.reversed === true, 'El sentido del juego se ha invertido');

  // Comprobar avance en orden invertido: de p2(1) retrocede a p1(0)
  game.nextTurn();
  assert(game.currentPlayerIndex === 0, 'El turno fluye hacia atrás (p2 a p1)');

  // 7. Probar Doble Tiro (Double Shot)
  game.currentPlayerIndex = 0; // p1 (Alejandro)
  p1.powers = [{ id: 'double_shot', name: 'Doble Tiro', type: 'buff' }];
  p1.hand = [[2, 2], [2, 3], [5, 5]]; // Forzar fichas (3 fichas para que no termine la ronda al jugar 2)
  game.board = [[1, 2]]; // Forzar extremo
  
  const resDouble = game.usePowerCard(p1.id, 'double_shot');
  assert(resDouble.success === true, 'Alejandro usa Doble Tiro');
  assert(game.activeEffects.doubleTurnActive === true, 'El doble turno está marcado como activo');

  // Jugar primera ficha
  const play1 = game.playTile(p1.id, 0, 'right'); // conecta [2,2]
  assert(play1.success === true, 'Alejandro juega su primera ficha');
  // El turno debería quedarse en Alejandro (index 0) y el flag doubleTurnActive debe consumirse (false)
  assert(game.currentPlayerIndex === 0, 'Alejandro conserva su turno para el Doble Tiro');
  assert(game.activeEffects.doubleTurnActive === false, 'El flag doubleTurnActive fue consumido');

  // Jugar segunda ficha
  const play2 = game.playTile(p1.id, 0, 'right'); // conecta [2,3]
  assert(play2.success === true, 'Alejandro juega su segunda ficha');
  // Ahora sí avanza el turno (retrocede a Carlos debido a reversa)
  assert(game.currentPlayerIndex === 2, 'El turno avanza normalmente tras la segunda jugada');

  // 8. Probar Extremo Congelado (Freeze)
  game.currentPlayerIndex = 2; // p3 (Carlos)
  p3.powers = [{ id: 'freeze', name: 'Congelar', type: 'attack' }];
  
  const resFreeze = game.usePowerCard(p3.id, 'freeze', 'left');
  assert(resFreeze.success === true, 'Carlos congela el extremo izquierdo');
  assert(game.activeEffects.frozenEnd === 'left', 'El extremo izquierdo está marcado como congelado');
  assert(game.activeEffects.frozenEndOwnerId === p3.id, 'Carlos es el dueño de la congelación');

  // Siguiente jugador en reversa es p2 (Sofía)
  game.nextTurn();
  assert(game.currentPlayerIndex === 1, 'Turno de Sofía');
  
  // Sofía tiene fichas jugables en el tablero [[1,2], [2,2], [2,3]] -> extremos son 1 e izquierdo y 3 derecho.
  // Intentar jugar en extremo izquierdo congelado
  p2.hand = [[1, 5], [3, 5]]; // [1,5] conecta a la izquierda (congelada), [3,5] conecta a la derecha (libre)
  const resPlayFrozen = game.playTile(p2.id, 0, 'left');
  assert(resPlayFrozen.success === false, 'Se deniega colocar una ficha en el extremo izquierdo congelado');

  // El extremo sigue congelado para el próximo jugador (Alejandro)
  const resPlayOk = game.playTile(p2.id, 1, 'right'); // jugar [3,5] a la derecha
  assert(resPlayOk.success === true, 'Sofía juega su ficha en el extremo derecho (no congelado)');
  
  // Turno de Alejandro (p1)
  assert(game.currentPlayerIndex === 0, 'Turno de Alejandro');
  assert(game.activeEffects.frozenEnd === 'left', 'El extremo izquierdo sigue congelado para Alejandro');
  
  // Alejandro pasa o juega, y avanza el turno a Carlos (p3)
  game.nextTurn();
  assert(game.currentPlayerIndex === 2, 'Vuelve el turno de Carlos');
  assert(game.activeEffects.frozenEnd === null, 'La congelación expira cuando vuelve el turno al dueño (Carlos)');

  // 9. Probar Intercambio Mental (Mind Swap)
  game.currentPlayerIndex = 2; // Carlos
  p3.powers = [{ id: 'mind_swap', name: 'Intercambio Mental', type: 'attack' }];
  p3.hand = [[1, 1]];
  p2.hand = [[5, 5], [6, 6]];
  const resMindSwap = game.usePowerCard(p3.id, 'mind_swap', p2.id);
  assert(resMindSwap.success === true, 'Carlos usa Intercambio Mental contra Sofía');
  assert(p3.hand.length === 2 && p3.hand[0][0] === 5, 'Carlos ahora tiene la mano de Sofía');
  assert(p2.hand.length === 1 && p2.hand[0][0] === 1, 'Sofía ahora tiene la mano de Carlos');

  // 10. Probar Ficha Dinamita (Tile Demolition)
  p3.powers = [{ id: 'tile_demolition', name: 'Ficha Dinamita', type: 'attack' }];
  const initialBoardLength = game.board.length;
  const resDemolition = game.usePowerCard(p3.id, 'tile_demolition', 'left');
  assert(resDemolition.success === true, 'Carlos usa Ficha Dinamita en el extremo izquierdo');
  assert(game.board.length === initialBoardLength - 1, 'La longitud del tablero disminuyó por 1');

  // 11. Probar Ficha Comodín (Wildcard)
  p3.powers = [{ id: 'wildcard', name: 'Ficha Comodín', type: 'buff' }];
  const resWildcard = game.usePowerCard(p3.id, 'wildcard');
  assert(resWildcard.success === true, 'Carlos usa Ficha Comodín');
  assert(game.activeEffects.wildcardActive === true, 'El flag de Ficha Comodín está activo');

  // Intentar jugar una ficha totalmente inválida (ej. [0,0] en tablero con extremos distintos de 0)
  p3.hand = [[0, 0], [4, 4]];
  const resPlayWild = game.playTile(p3.id, 0, 'right');
  assert(resPlayWild.success === true, 'Se permite jugar cualquier ficha con el Comodín activo');
  assert(game.activeEffects.wildcardActive === false, 'El flag de Ficha Comodín fue consumido');

  // 12. Probar Reinicio Estelar (Boneyard Reset)
  // Sofía en turno
  game.currentPlayerIndex = 1;
  p2.powers = [{ id: 'boneyard_reset', name: 'Reinicio Estelar', type: 'buff' }];
  p2.hand = [[2, 2], [3, 3]];
  game.boneyard = [[6, 6], [5, 4], [3, 2]]; // forzar pozo
  const initialBoneyardLength = game.boneyard.length;
  const resReset = game.usePowerCard(p2.id, 'boneyard_reset');
  assert(resReset.success === true, 'Sofía usa Reinicio Estelar. Error: ' + resReset.error);
  assert(p2.hand.length === 2, 'Sofía sigue teniendo 2 fichas');
  assert(game.boneyard.length === initialBoneyardLength, 'El número total de fichas en el pozo se conserva');

  // 13. Probar Atracción Magnética (Magnetic Pull)
  p2.powers = [{ id: 'magnetic_pull', name: 'Atracción Magnética', type: 'attack' }];
  game.boneyard = [[2, 2], [3, 3], [4, 4]]; // no jugables para extremos 1 y 0
  p3.hand = [[6, 6]];
  const resPull = game.usePowerCard(p2.id, 'magnetic_pull', p3.id);
  assert(resPull.success === true, 'Sofía usa Atracción Magnética sobre Carlos');
  assert(p3.hand.length === 4, 'Carlos fue obligado a robar 3 fichas ya que no tenía jugables');

  // 14. Probar Ruleta Rusa (Russian Roulette)
  p2.powers = [{ id: 'russian_roulette', name: 'Ruleta Rusa', type: 'caos' }];
  p1.hand = [[1, 1]];
  p2.hand = [[2, 2]];
  p3.hand = [[3, 3], [3, 4], [3, 5], [3, 6]];
  // reversed está en true, por lo que el paso va hacia la izquierda: p1 -> p3, p2 -> p1, p3 -> p2
  const resRoulette = game.usePowerCard(p2.id, 'russian_roulette');
  assert(resRoulette.success === true, 'Sofía activa la Ruleta Rusa');
  assert(p1.hand.length === 1 && p1.hand[0][0] === 2, 'p1 recibió la ficha de p2');
  assert(p2.hand.length === 1 && p2.hand.some(tile => tile[0] === 3), 'p2 recibió una de las fichas de p3');

  // 15. Probar Prevención de Autoselección de Objetivo
  p2.powers = [{ id: 'mind_swap', name: 'Intercambio Mental', type: 'attack' }];
  const resSelfTarget = game.usePowerCard(p2.id, 'mind_swap', p2.id);
  assert(resSelfTarget.success === false, 'Se impide autoseleccionarse como objetivo de poder de ataque');

  console.log("=== PRUEBAS DE PODERES COMPLETADAS CON ÉXITO ===");
}

try {
  runPowerTests();
} catch (error) {
  console.error("❌ ERROR EN LAS PRUEBAS:", error.stack);
  process.exit(1);
}
