// Pruebas de la IA de los bots y del alta/baja de bots en la sala.

const DominoGame = require('./gameLogic');
const { chooseMove, choosePower, pickBotName, scoreMove } = require('./botLogic');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`✓ ${message}`);
}

function makeGame(opts = {}) {
  const game = new DominoGame('BOTS', null, { powersEnabled: false, ...opts });
  game.addPlayer('p1', 'Humano', 's1');
  return game;
}

function setup(game, { hands, board = [], boneyard = [], turn = 0 }) {
  game.players.forEach((p, i) => { p.hand = hands[i].map(t => [...t]); });
  game.board = board.map(t => [...t]);
  game.boneyard = boneyard.map(t => [...t]);
  game.currentPlayerIndex = turn;
  game.status = 'playing';
}

function runTests() {
  console.log('=== PRUEBAS DE BOTS ===');

  // --- getValidMoves ---
  {
    const g = makeGame();
    g.addBot('Rita', 'normal');
    g.startNewGame();
    setup(g, { hands: [[[0, 0]], [[2, 4], [5, 6], [1, 1]]], board: [[2, 3], [3, 5]] });
    // extremos: izq=2, der=5
    const moves = g.getValidMoves(g.players[1].id);
    assert(moves.length === 2, `getValidMoves: encuentra las 2 jugadas legales (halló ${moves.length})`);
    assert(moves.some(m => m.tileIndex === 0 && m.side === 'left'), 'getValidMoves: [2,4] por la izquierda');
    assert(moves.some(m => m.tileIndex === 1 && m.side === 'right'), 'getValidMoves: [5,6] por la derecha');
    assert(!moves.some(m => m.tileIndex === 2), 'getValidMoves: descarta la ficha que no pega');
    assert(g.findValidMove(g.players[1].id).tileIndex === 0, 'findValidMove sigue devolviendo la primera');
  }

  // --- resultingEnd ---
  {
    const g = makeGame();
    g.addBot('Rita');
    g.startNewGame();
    setup(g, { hands: [[[0, 0]], [[2, 4]]], board: [[2, 3], [3, 5]] });
    const bot = g.players[1].id;
    assert(g.resultingEnd(bot, { tileIndex: 0, side: 'left' }) === 4,
      'resultingEnd: jugar [2,4] por la izquierda deja el 4 expuesto');
  }

  // --- Bot normal: suelta la ficha más cara ---
  {
    const g = makeGame();
    g.addBot('Rita', 'normal');
    g.startNewGame();
    // Ambas pegan por la derecha (5): [5,0]=5 puntos y [5,6]=11 puntos
    setup(g, { hands: [[[0, 0]], [[5, 0], [5, 6]]], board: [[2, 3], [3, 5]], turn: 1 });
    const move = chooseMove(g, g.players[1].id);
    assert(move.tileIndex === 1, 'Bot normal: elige soltar la ficha de más puntos ([5,6] sobre [5,0])');
  }

  // --- Bot normal: prioriza los dobles ---
  {
    const g = makeGame();
    g.addBot('Rita', 'normal');
    g.startNewGame();
    // [5,5]=10+6 bonus doble = 16 ; [5,6]=11
    setup(g, { hands: [[[0, 0]], [[5, 6], [5, 5]]], board: [[2, 3], [3, 5]], turn: 1 });
    const move = chooseMove(g, g.players[1].id);
    assert(move.tileIndex === 1, 'Bot normal: prefiere colocar el doble, que es lo que peor se coloca luego');
  }

  // --- Bot fácil: se mantiene legal ---
  {
    const g = makeGame();
    g.addBot('Rita', 'facil');
    g.startNewGame();
    setup(g, { hands: [[[0, 0]], [[2, 4], [5, 6], [1, 1]]], board: [[2, 3], [3, 5]], turn: 1 });
    const legal = g.getValidMoves(g.players[1].id);
    for (let i = 0; i < 40; i++) {
      const m = chooseMove(g, g.players[1].id);
      assert.silent = true;
      if (!legal.some(l => l.tileIndex === m.tileIndex && l.side === m.side)) {
        throw new Error('ASSERTION FAILED: el bot fácil eligió una jugada ilegal');
      }
    }
    assert(true, 'Bot fácil: en 40 tiradas nunca eligió una jugada ilegal');
  }

  // --- Bot difícil: bloquea con lo que sabe de los pases ---
  {
    const g = makeGame();
    g.addBot('Yuri', 'dificil');
    g.startNewGame();
    // Bot puede dejar expuesto el 4 o el 0. El humano ya pasó sobre el 4.
    setup(g, { hands: [[[0, 0]], [[5, 4], [5, 0]]], board: [[2, 3], [3, 5]], turn: 1 });
    g.playerPassedOn = { p1: [4] };
    const move = chooseMove(g, g.players[1].id);
    assert(move.tileIndex === 0,
      'Bot difícil: deja expuesto el número sobre el que el rival ya pasó (bloquea)');

    // Sin esa información, gana el criterio de puntos ([5,0] no; [5,4] son más puntos)
    g.playerPassedOn = {};
    const plain = chooseMove(g, g.players[1].id);
    assert(plain.tileIndex === 0, 'Bot difícil: sin información de pases decide por puntos');
  }

  // --- Bot difícil: registra los pases automáticamente ---
  {
    const g = makeGame();
    g.addBot('Yuri', 'dificil');
    g.startNewGame();
    setup(g, { hands: [[[6, 6]], [[1, 1]]], board: [[2, 3], [3, 5]], boneyard: [], turn: 0 });
    const r = g.passTurn('p1');
    assert(r.success, 'El humano pasa turno');
    assert(g.playerPassedOn['p1'].includes(2) && g.playerPassedOn['p1'].includes(5),
      'Un pase queda registrado sobre AMBOS extremos (2 y 5)');
  }

  // --- Poderes ---
  {
    const g = new DominoGame('P', null, { powersEnabled: true });
    g.addPlayer('p1', 'Humano', 's1');
    const bot = g.addBot('Rita', 'normal');
    // Los bots hay que crearlos ANTES de arrancar: addBot rechaza con la
    // partida en curso, que es justo lo que queremos que haga.
    const easy = g.addBot('Chema', 'facil');
    g.startNewGame();

    bot.powers = [{ id: 'shield', name: 'Escudo', type: 'defense' }];
    const always = choosePower(g, bot.id, () => 0); // random=0 => siempre usa
    assert(always === 'shield', 'Bot: usa un poder sin objetivo cuando le toca');

    const never = choosePower(g, bot.id, () => 0.99); // random alto => no usa
    assert(never === null, 'Bot: no gasta poderes en todos los turnos');

    bot.powers = [{ id: 'mind_swap', name: 'Intercambio', type: 'attack' }];
    assert(choosePower(g, bot.id, () => 0) === null,
      'Bot: ignora los poderes que exigen elegir objetivo (aún no sabe apuntar)');

    easy.powers = [{ id: 'shield', name: 'Escudo', type: 'defense' }];
    assert(choosePower(g, easy.id, () => 0) === null, 'Bot fácil: no usa poderes');
  }

  // --- Modo clásico: nadie usa poderes ---
  {
    const g = makeGame();
    const bot = g.addBot('Rita', 'dificil');
    g.startNewGame();
    bot.powers = [{ id: 'shield', name: 'Escudo', type: 'defense' }];
    assert(choosePower(g, bot.id, () => 0) === null, 'Sala clásica: los bots tampoco usan poderes');
  }

  // --- Alta y baja de bots ---
  {
    const g = makeGame();
    assert(g.addBot('Rita', 'dificil').difficulty === 'dificil', 'addBot: respeta la dificultad difícil');
    assert(g.addBot('Yuri', 'maestro').difficulty === 'maestro', 'addBot: respeta la dificultad maestro');
    assert(g.addBot('Chema', 'inventada').difficulty === 'normal', 'addBot: una dificultad inválida cae a normal');
    assert(g.players[1].ready === true, 'addBot: el bot entra ya listo');
    assert(g.allReady() === false, 'allReady: sigue esperando al humano');

    g.toggleReady('s1');
    assert(g.allReady() === true, 'allReady: con el humano listo, la partida puede empezar');

    assert(g.hasHumans() === true, 'hasHumans: detecta al humano');
    g.removePlayerById('p1');
    assert(g.hasHumans() === false, 'hasHumans: sin humanos la sala queda vacía de verdad');

    g.addBot('Tere'); g.addBot('Bruno');
    assert(g.players.length === 4, 'La sala admite 4 jugadores');
    assert(g.addBot('Pilar') === null, 'addBot: no se pasa del máximo de 4');
  }

  // --- Nombres ---
  {
    const name = pickBotName(['Rita', 'Chema']);
    assert(!['Rita', 'Chema'].includes(name), `pickBotName: no repite nombres ya usados (dio "${name}")`);
  }

  // --- Una partida entera solo de bots termina sin colgarse ---
  {
    const g = new DominoGame('ALLBOTS', null, { powersEnabled: false });
    g.addBot('Rita', 'dificil');
    g.addBot('Chema', 'normal');
    g.addBot('Yuri', 'facil');
    g.startNewGame();

    let turns = 0;
    while (g.status === 'playing' && turns < 500) {
      const cur = g.players[g.currentPlayerIndex];
      const move = chooseMove(g, cur.id);
      if (move) {
        const r = g.playTile(cur.id, move.tileIndex, move.side);
        if (!r.success) g.forceTurn();
      } else {
        g.forceTurn();
      }
      turns++;
    }
    assert(g.status !== 'playing', `Una ronda solo de bots llega a su fin (en ${turns} turnos)`);
    assert(turns < 500, 'La ronda termina sin bucle infinito');
    assert(g.roundWinner !== null, `Hay un resultado de ronda: ${g.roundWinner}`);
  }

  console.log('\n=== TODAS LAS PRUEBAS DE BOTS PASARON ===');
}

try {
  runTests();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
