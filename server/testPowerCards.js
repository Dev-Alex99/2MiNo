// Script de prueba para validar la lógica del sistema de Cartas de Poderes.
const DominoGame = require('./gameLogic');
const { POWER_CATALOG, RARITY_COPIES, INTENSITY_RARITIES } = DominoGame;

// Tamaño esperado del mazo para una intensidad dada.
function deckSizeFor(intensity) {
  const allowed = INTENSITY_RARITIES[intensity];
  let total = 0;
  Object.values(POWER_CATALOG).forEach(c => {
    if (allowed.includes(c.rarity)) total += RARITY_COPIES[c.rarity];
  });
  return total;
}

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

  // Asegurar que el mazo de poderes tiene las cartas restantes (intensidad
  // normal por defecto): total del mazo menos las 6 repartidas (3 jugadores × 2).
  const expectedRemaining = deckSizeFor('normal') - 6;
  assert(game.powerDeck.length === expectedRemaining,
    `El mazo de poderes (normal) contiene las ${expectedRemaining} cartas restantes`);

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

// --- Pruebas de arreglos y poderes nuevos (V2) ---
function freshGame(opts) {
  const g = new DominoGame('V2', 100, opts || {});
  g.addPlayer('p1', 'A', 's1');
  g.addPlayer('p2', 'B', 's2');
  g.addPlayer('p3', 'C', 's3');
  g.toggleReady('s1'); g.toggleReady('s2'); g.toggleReady('s3');
  g.startNewGame();
  return g;
}

function runPowerV2Tests() {
  console.log("\n=== PRUEBAS V2: ARREGLOS Y PODERES NUEVOS ===");

  // A. Doble Tiro ya no se filtra al rival tras pasar.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a] = g.players;
    g.board = [[3, 3]]; g.boneyard = [];
    a.hand = [[1, 2]]; a.powers = [{ id: 'double_shot' }];
    assert(g.usePowerCard(a.id, 'double_shot').success === true, 'V2: se usa Doble Tiro');
    assert(g.activeEffects.doubleTurnActive === true, 'V2: doble turno queda activo');
    assert(g.passTurn(a.id).success === true, 'V2: el lanzador pasa (no tenía jugada)');
    assert(g.activeEffects.doubleTurnActive === false, 'V2: Doble Tiro NO se filtra al rival tras pasar');
  }

  // B. El Escudo bloquea también Robo del Destino.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a, b] = g.players;
    a.powers = [{ id: 'destiny_steal' }];
    b.powers = [{ id: 'shield' }, { id: 'reverse' }];
    b.shieldActive = true;
    const r = g.usePowerCard(a.id, 'destiny_steal', b.id);
    assert(r.success === true && r.shielded === true, 'V2: el Escudo bloquea Robo del Destino');
    assert(b.powers.length === 2, 'V2: no se robó ninguna carta al escudado');
  }

  // C. El Escudo del jugador saltado NO se apaga.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a, b] = g.players;
    b.shieldActive = true;
    g.board = [[3, 3]]; g.boneyard = []; a.hand = [[1, 2]]; a.powers = [{ id: 'skip' }];
    g.usePowerCard(a.id, 'skip');
    g.passTurn(a.id);
    assert(b.shieldActive === true, 'V2: el escudo del jugador saltado sigue activo');
    assert(g.currentPlayerIndex === 2, 'V2: el turno saltó al siguiente jugador');
  }

  // D. Bloqueo Total congela ambos extremos.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a, b] = g.players;
    g.board = [[3, 4]]; a.powers = [{ id: 'block_both' }];
    g.usePowerCard(a.id, 'block_both');
    assert(g.activeEffects.frozenEnd === 'both', 'V2: Bloqueo Total marca ambos extremos');
    const bl = g.endsBlockedFor(b.id);
    assert(bl.leftBlocked && bl.rightBlocked, 'V2: el oponente no puede jugar en ningún extremo');
    const own = g.endsBlockedFor(a.id);
    assert(!own.leftBlocked && !own.rightBlocked, 'V2: el dueño del bloqueo sí puede jugar');
  }

  // E. Tormenta: todos los oponentes roban 1.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a, b, c] = g.players;
    g.boneyard = [[0, 0], [1, 1], [2, 2], [3, 3]];
    const bBefore = b.hand.length, cBefore = c.hand.length, aBefore = a.hand.length;
    a.powers = [{ id: 'storm' }];
    assert(g.usePowerCard(a.id, 'storm').success === true, 'V2: se usa Tormenta');
    assert(b.hand.length === bBefore + 1 && c.hand.length === cBefore + 1, 'V2: cada oponente roba 1');
    assert(a.hand.length === aBefore, 'V2: el lanzador de Tormenta no roba');
  }

  // F. Segunda Oportunidad: robas hasta tener jugada.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a] = g.players;
    g.board = [[3, 3]]; a.hand = [[1, 2]]; g.boneyard = [[0, 0], [0, 0], [3, 6]];
    a.powers = [{ id: 'second_wind' }];
    assert(g.usePowerCard(a.id, 'second_wind').success === true, 'V2: se usa Segunda Oportunidad');
    assert(a.hand.length === 2, 'V2: robó justo hasta tener jugada');
    assert(g.hasValidMove(a.id) === true, 'V2: ahora tiene jugada');
  }

  // G. Ojo Total: revela todas las manos al dueño, a nadie más.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a, b, c] = g.players;
    a.powers = [{ id: 'spy_all' }];
    g.usePowerCard(a.id, 'spy_all');
    const stA = g.getGameStateForPlayer(a.id);
    const bInA = stA.players.find(p => p.id === b.id);
    assert(bInA.hand.length > 0, 'V2: Ojo Total revela la mano de los oponentes al dueño');
    const stC = g.getGameStateForPlayer(c.id);
    const aInC = stC.players.find(p => p.id === a.id);
    assert(aInC.hand.length === 0, 'V2: Ojo Total no revela nada a los demás');
  }

  // G2. Ojo Soplón: revela SOLO la mano del objetivo, y solo al dueño.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a, b, c] = g.players;
    a.powers = [{ id: 'spy_eye' }];
    g.usePowerCard(a.id, 'spy_eye', b.id);
    const stA = g.getGameStateForPlayer(a.id);
    assert(stA.players.find(p => p.id === b.id).hand.length > 0, 'V2: Ojo Soplón revela la mano del objetivo al dueño');
    assert(stA.players.find(p => p.id === c.id).hand.length === 0, 'V2: Ojo Soplón no revela a otros oponentes');
    const stC = g.getGameStateForPlayer(c.id);
    assert(stC.players.find(p => p.id === b.id).hand.length === 0, 'V2: Ojo Soplón no revela la mano a quien no lo lanzó');
  }

  // H. Maldición: restringe a un extremo y expira tras el turno del maldito.
  {
    const g = freshGame();
    g.currentPlayerIndex = 0;
    const [a, b] = g.players;
    g.board = [[1, 6]]; a.powers = [{ id: 'curse' }];
    g.usePowerCard(a.id, 'curse', b.id);
    assert(g.activeEffects.cursedPlayerId === b.id, 'V2: la maldición se aplica al objetivo');
    g.activeEffects.cursedSide = 'right'; // fijamos el lado para un test determinista
    const bl = g.endsBlockedFor(b.id);
    assert(bl.leftBlocked === true && bl.rightBlocked === false, 'V2: el maldito solo juega en un extremo');
    b.hand = [[1, 1], [6, 2]];
    const moves = g.getValidMoves(b.id);
    assert(moves.length > 0 && moves.every(m => m.side === 'right'), 'V2: sin soft-lock, solo jugadas en el lado permitido');
    g.currentPlayerIndex = 1;
    g.nextTurn();
    assert(g.activeEffects.cursedPlayerId === null, 'V2: la maldición expira tras el turno del maldito');
  }

  // I. Un poder por turno.
  {
    const g = freshGame({ onePowerPerTurn: true });
    g.currentPlayerIndex = 0;
    const [a] = g.players;
    a.powers = [{ id: 'shield' }, { id: 'reverse' }];
    assert(g.usePowerCard(a.id, 'shield').success === true, 'V2: primer poder del turno OK');
    const second = g.usePowerCard(a.id, 'reverse');
    assert(second.success === false && second.error === 'srv.err.onePowerPerTurn', 'V2: segundo poder bloqueado');
  }

  // J. Intensidad: filtra rarezas del mazo.
  {
    const gl = new DominoGame('LIGHT', 100, { powerIntensity: 'light' });
    gl.addPlayer('p1', 'A', 's1'); gl.addPlayer('p2', 'B', 's2');
    gl.toggleReady('s1'); gl.toggleReady('s2'); gl.startNewGame();
    const allLight = [...gl.powerDeck, ...gl.players.flatMap(p => p.powers)];
    assert(allLight.every(c => c.rarity === 'common'), 'V2: intensidad ligera solo reparte comunes');
    assert(gl.powerDeck.length + 4 === deckSizeFor('light'), 'V2: tamaño del mazo ligero correcto');

    const gc = new DominoGame('CHAOS', 100, { powerIntensity: 'chaos' });
    gc.addPlayer('p1', 'A', 's1'); gc.addPlayer('p2', 'B', 's2');
    gc.toggleReady('s1'); gc.toggleReady('s2'); gc.startNewGame();
    const allChaos = [...gc.powerDeck, ...gc.players.flatMap(p => p.powers)];
    assert(allChaos.some(c => c.rarity === 'legendary'), 'V2: intensidad caos incluye legendarios');
    assert(gc.powerDeck.length + 4 === deckSizeFor('chaos'), 'V2: tamaño del mazo caos correcto');
  }

  console.log("=== PRUEBAS V2 COMPLETADAS CON ÉXITO ===");
}

try {
  runPowerTests();
  runPowerV2Tests();
} catch (error) {
  console.error("❌ ERROR EN LAS PRUEBAS:", error.stack);
  process.exit(1);
}
