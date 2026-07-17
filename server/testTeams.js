// Pruebas del modo parejas (2v2) y de la opción de robar del pozo.

const DominoGame = require('./gameLogic');
const { chooseMove } = require('./botLogic');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`✓ ${message}`);
}

function seat4(opts = {}) {
  const g = new DominoGame('T', null, { powersEnabled: false, teamsEnabled: true, ...opts });
  ['Ana', 'Beto', 'Caro', 'Dani'].forEach((n, i) => g.addPlayer(`p${i + 1}`, n, `s${i + 1}`));
  return g;
}

function setup(game, { hands, board = [], boneyard = [], turn = 0 }) {
  game.players.forEach((p, i) => { p.hand = hands[i].map(t => [...t]); });
  game.board = board.map(t => [...t]);
  game.boneyard = boneyard.map(t => [...t]);
  game.currentPlayerIndex = turn;
  game.status = 'playing';
  game.passedTurns = 0;
}

function runTests() {
  console.log('=== PRUEBAS DE PAREJAS Y POZO ===');

  // --- Asignación de equipos ---
  {
    const g = seat4();
    assert(g.players.map(p => p.team).join('') === '0101',
      'Los equipos se reparten por asiento: pares vs impares (0,1,0,1)');
    assert(g.players[0].team === g.players[2].team, 'Ana y Caro son pareja');
    assert(g.players[1].team === g.players[3].team, 'Beto y Dani son pareja');
    assert(g.players[0].team !== g.players[1].team, 'Los compañeros nunca juegan seguidos');
  }

  // --- Parejas exigen mesa completa ---
  {
    const g = new DominoGame('T2', null, { teamsEnabled: true });
    g.addPlayer('p1', 'Ana', 's1');
    g.addPlayer('p2', 'Beto', 's2');
    g.players.forEach(p => { p.ready = true; });
    assert(g.allReady() === false, 'Parejas: con 2 jugadores NO se puede empezar');
    g.addPlayer('p3', 'Caro', 's3');
    g.players.forEach(p => { p.ready = true; });
    assert(g.allReady() === false, 'Parejas: con 3 jugadores tampoco');
    g.addPlayer('p4', 'Dani', 's4');
    g.players.forEach(p => { p.ready = true; });
    assert(g.allReady() === true, 'Parejas: con los 4 ya se puede');

    const indiv = new DominoGame('T3', null, { teamsEnabled: false });
    indiv.addPlayer('p1', 'Ana', 's1');
    indiv.addPlayer('p2', 'Beto', 's2');
    indiv.players.forEach(p => { p.ready = true; });
    assert(indiv.allReady() === true, 'Individual: 2 jugadores siguen bastando');
  }

  // --- Al quitar un jugador se recalculan los equipos ---
  {
    const g = seat4();
    g.removePlayerById('p2');
    assert(g.players.map(p => p.team).join('') === '010',
      'Al salir alguien los equipos se recalculan por asiento');
  }

  // --- Cambiar de sitio = elegir compañero ---
  {
    const g = seat4();
    // De salida: Ana+Caro vs Beto+Dani. Ana quiere ser pareja de Dani.
    assert(g.players[0].team === g.players[2].team, 'De salida Ana va con Caro');

    const ok = g.swapSeats('p3', 'p4'); // Caro <-> Dani
    assert(ok === true, 'swapSeats: el intercambio se realiza');
    assert(g.players.map(p => p.name).join(',') === 'Ana,Beto,Dani,Caro',
      `El orden de asientos cambia: ${g.players.map(p => p.name).join(',')}`);

    const ana = g.players.find(p => p.name === 'Ana');
    const dani = g.players.find(p => p.name === 'Dani');
    const caro = g.players.find(p => p.name === 'Caro');
    assert(ana.team === dani.team, 'Ahora Ana es pareja de Dani');
    assert(ana.team !== caro.team, 'Y Caro pasa al equipo rival');
    assert(g.players.map(p => p.team).join('') === '0101',
      'Los equipos se recalculan y siguen alternados');
  }

  // --- Límites del intercambio ---
  {
    const g = seat4();
    assert(g.swapSeats('p1', 'p1') === false, 'swapSeats: no se puede intercambiar consigo mismo');
    assert(g.swapSeats('p1', 'fantasma') === false, 'swapSeats: se rechaza un jugador inexistente');

    g.startNewGame();
    assert(g.status === 'playing', 'La partida arranca');
    assert(g.swapSeats('p1', 'p2') === false,
      'swapSeats: no se puede cambiar de sitio con la partida en curso');
  }

  // --- Puntuación: gana el EQUIPO y suma lo de los DOS rivales ---
  {
    const g = seat4();
    g.startNewGame();
    // Ana (equipo 0) se queda sin fichas. Rivales: Beto y Dani (equipo 1).
    setup(g, {
      hands: [[[5, 4]], [[6, 6]], [[3, 3]], [[2, 1]]],
      board: [[2, 3], [3, 5]],
      turn: 0
    });
    const r = g.playTile('p1', 0, 'right');
    assert(r.success, 'Ana juega su última ficha');
    assert(g.status === 'round_ended', 'La ronda termina');
    // Beto [6,6]=12 + Dani [2,1]=3 => 15. Caro (compañera) NO cuenta.
    assert(g.teamScores[0] === 15,
      `El equipo de Ana suma los puntos de los DOS rivales: 12+3=15 (dio ${g.teamScores[0]})`);
    assert(g.teamScores[1] === 0, 'El equipo rival no suma nada');
    assert(g.players.every(p => p.score === 0), 'En parejas no se usa la puntuación individual');
    assert(g.roundWinnerTeam === 0, 'Se identifica al equipo ganador de la ronda');
  }

  // --- La mano del compañero NO puntúa para el rival ---
  {
    const g = seat4();
    g.startNewGame();
    setup(g, {
      hands: [[[5, 4]], [[6, 6]], [[6, 6]], [[2, 1]]], // Caro lleva 12 puntos
      board: [[2, 3], [3, 5]],
      turn: 0
    });
    g.playTile('p1', 0, 'right');
    assert(g.teamScores[0] === 15,
      `Los puntos de la compañera Caro no cuentan en contra (sigue 15, dio ${g.teamScores[0]})`);
  }

  // --- Tranca: gana la pareja con menos puntos entre los dos ---
  {
    const g = seat4();
    g.startNewGame();
    setup(g, {
      // equipo 0: Ana[6,6]=12 + Caro[1,0]=1 => 13
      // equipo 1: Beto[2,2]=4 + Dani[3,3]=6 => 10  (gana el 1)
      hands: [[[6, 6]], [[2, 2]], [[1, 0]], [[3, 3]]],
      board: [[4, 5], [5, 4]],
      boneyard: [],
      turn: 0
    });
    g.passedTurns = 3;
    const r = g.passTurn('p1');
    assert(r.success, 'Ana pasa y se tranca la ronda');
    assert(g.status === 'round_ended', 'La tranca cierra la ronda');
    assert(g.roundWinnerTeam === 1, 'Tranca: gana la pareja con menos puntos entre los dos');
    assert(g.teamScores[1] === 13, `El equipo ganador se lleva los 13 del rival (dio ${g.teamScores[1]})`);
    const starter = g.players.find(p => p.id === g.startingPlayerId);
    assert(starter.team === 1 && starter.id === 'p2',
      'Sale el miembro del equipo ganador con la mano más baja (Beto, 4)');
  }

  // --- Tranca empatada: nadie puntúa ---
  {
    const g = seat4();
    g.startNewGame();
    setup(g, {
      hands: [[[3, 3]], [[3, 3]], [[1, 1]], [[1, 1]]], // 8 vs 8
      board: [[4, 5], [5, 4]], boneyard: [], turn: 0
    });
    g.passedTurns = 3;
    g.passTurn('p1');
    assert(g.roundWinner === 'tie', 'Tranca empatada entre parejas: empate');
    assert(g.teamScores[0] === 0 && g.teamScores[1] === 0, 'En el empate no puntúa nadie');
  }

  // --- Fin de partida por equipo ---
  {
    const g = seat4();
    g.startNewGame();
    g.teamScores = [g.maxScore - 5, 0];
    setup(g, { hands: [[[5, 4]], [[6, 6]], [[3, 3]], [[2, 1]]], board: [[2, 3], [3, 5]], turn: 0 });
    g.playTile('p1', 0, 'right');
    assert(g.status === 'game_ended', 'La partida acaba al llegar el equipo al límite');
    assert(g.gameWinnerTeam === 0, 'Se identifica el equipo campeón');
    assert(g.gameWinner === 'team_0', 'gameWinner marca el equipo, no a un jugador');
  }

  // --- El estado expone todo lo de equipos ---
  {
    const g = seat4();
    g.startNewGame();
    const st = g.getGameStateForPlayer('p1');
    assert(st.teamsEnabled === true, 'El estado expone teamsEnabled');
    assert(Array.isArray(st.teamScores) && st.teamScores.length === 2, 'El estado expone teamScores');
    assert(st.teamNames.length === 2, 'El estado expone los nombres de los equipos');
    assert(st.players.every(p => p.team === 0 || p.team === 1), 'Cada jugador lleva su equipo');
  }

  // --- Opción: sin robar del pozo ---
  {
    const g = new DominoGame('NODRAW', null, { powersEnabled: false, drawEnabled: false });
    g.addPlayer('p1', 'Ana', 's1');
    g.addPlayer('p2', 'Beto', 's2');
    g.startNewGame();
    setup(g, { hands: [[[6, 6]], [[1, 1]]], board: [[2, 3], [3, 5]], boneyard: [[0, 0], [1, 4]], turn: 0 });

    const drew = g.drawTile('p1');
    assert(drew.success === false, 'Sin pozo: robar se rechaza aunque queden fichas');
    assert(drew.error === 'srv.err.drawDisabled', `El error lo explica (clave i18n): "${drew.error}"`);

    const passed = g.passTurn('p1');
    assert(passed.success === true, 'Sin pozo: se puede pasar aunque queden fichas en el pozo');
    assert(g.boneyard.length === 2, 'El pozo queda intacto: esas fichas están fuera de juego');
  }

  // --- Con pozo (por defecto) sigue obligando a robar ---
  {
    const g = new DominoGame('DRAW', null, { powersEnabled: false });
    g.addPlayer('p1', 'Ana', 's1');
    g.addPlayer('p2', 'Beto', 's2');
    g.startNewGame();
    setup(g, { hands: [[[6, 6]], [[1, 1]]], board: [[2, 3], [3, 5]], boneyard: [[0, 0]], turn: 0 });
    assert(g.drawEnabled === true, 'Robar está activo por defecto');
    const passed = g.passTurn('p1');
    assert(passed.success === false, 'Con pozo: no puedes pasar si aún puedes robar');
    assert(g.drawTile('p1').success === true, 'Con pozo: sí puedes robar');
  }

  // --- forceTurn respeta la opción de pozo ---
  {
    const g = new DominoGame('FT', null, { powersEnabled: false, drawEnabled: false });
    g.addPlayer('p1', 'Ana', 's1');
    g.addPlayer('p2', 'Beto', 's2');
    g.startNewGame();
    setup(g, { hands: [[[6, 6]], [[1, 1]]], board: [[2, 3], [3, 5]], boneyard: [[0, 0], [1, 4]], turn: 0 });
    const r = g.forceTurn();
    assert(r.action === 'passed', 'El reloj pasa turno sin robar cuando la sala no tiene pozo');
    assert(r.drew === 0, 'El reloj no roba ninguna ficha');
  }

  // --- El bot no ahoga a su compañero ---
  {
    const g = seat4();
    g.startNewGame();
    g.players[1].isBot = true;
    g.players[1].difficulty = 'dificil';
    // Beto (equipo 1) puede dejar el 4 o el 0.
    // Su COMPAÑERO Dani pasó sobre el 4 => debe evitarlo.
    setup(g, { hands: [[[0, 0]], [[5, 4], [5, 0]], [[0, 0]], [[0, 0]]], board: [[2, 3], [3, 5]], turn: 1 });
    g.playerPassedOn = { p4: [4] };
    const move = chooseMove(g, 'p2');
    assert(move.tileIndex === 1,
      'Bot en parejas: evita dejar expuesto un número sobre el que pasó su compañero');

    // Si quien pasó sobre el 4 es un RIVAL, entonces sí se lo deja.
    g.playerPassedOn = { p1: [4] };
    const blocking = chooseMove(g, 'p2');
    assert(blocking.tileIndex === 0, 'Bot en parejas: sí bloquea al rival con ese mismo número');
  }

  // --- Compatibilidad: sin equipos todo sigue como antes ---
  {
    const g = new DominoGame('IND', null, { powersEnabled: false });
    g.addPlayer('p1', 'Ana', 's1');
    g.addPlayer('p2', 'Beto', 's2');
    g.startNewGame();
    setup(g, { hands: [[[5, 4]], [[6, 6]]], board: [[2, 3], [3, 5]], turn: 0 });
    g.playTile('p1', 0, 'right');
    assert(g.players[0].score === 12, 'Individual: el jugador suma en su marcador personal');
    assert(g.teamScores[0] === 0 && g.teamScores[1] === 0, 'Individual: no se tocan los marcadores de equipo');
    assert(g.roundWinner === 'p1', 'Individual: el ganador es un jugador');
  }

  console.log('\n=== TODAS LAS PRUEBAS DE PAREJAS Y POZO PASARON ===');
}

try {
  runTests();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
