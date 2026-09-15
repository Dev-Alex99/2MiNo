// Estado público, historial completo y azar sembrable.
//
// Cubre los cuatro bugs de motor corregidos en el rediseño y el RNG inyectable:
// cada bloque vuelve a rojo si se revierte su arreglo. La regla que atraviesa
// todo el archivo: se difunde lo que un humano PODRÍA deducir mirando la mesa
// (pases, fichas jugadas, extremos abiertos) y nada más.
const assert = require('assert');
const DominoGame = require('./gameLogic');
const { POWER_CATALOG } = DominoGame;

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

console.log('=== PRUEBAS DE ESTADO PÚBLICO ===');

// Mesa de 2 con el pozo vacío (así pasar es legal) y extremos controlados:
// izquierda=2, derecha=5.
function mesa(opts = {}) {
  const g = new DominoGame('PUB', null, { powersEnabled: true, maxPip: 6, drawEnabled: false, ...opts });
  g.addPlayer('p1', 'Ana', 's1');
  g.addPlayer('p2', 'Beto', 's2');
  g.players.forEach(p => { p.ready = true; });
  g.startNewGame();

  g.board = [[2, 3], [3, 5]];
  g.boneyard = [];
  g.status = 'playing';
  g.passedTurns = 0;
  g.playerPassedOn = {};
  g.moveLog = [];
  return g;
}

// Copia del algoritmo del cliente (ReplayModal.buildStates): reconstruye la
// cadena a partir del historial. Si el motor deja de registrar una jugada, la
// repetición se desmonta aquí antes que en producción.
function reconstruir(moveLog) {
  let chain = [];
  let leftEnd = null;
  let rightEnd = null;
  for (const mv of moveLog) {
    if (!mv || mv.action !== 'play' || !Array.isArray(mv.tile)) continue;
    const tile = mv.tile;
    if (chain.length === 0) {
      chain = [[tile[0], tile[1]]];
      leftEnd = tile[0];
      rightEnd = tile[1];
    } else if (mv.side === 'left') {
      const oriented = tile[1] === leftEnd ? [tile[0], tile[1]] : [tile[1], tile[0]];
      chain = [oriented, ...chain];
      leftEnd = oriented[0];
    } else {
      const oriented = tile[0] === rightEnd ? [tile[0], tile[1]] : [tile[1], tile[0]];
      chain = [...chain, oriented];
      rightEnd = oriented[1];
    }
  }
  return chain;
}

// ─── 1. playerPassedOn es información pública y viaja en el estado ───
(() => {
  const g = mesa();
  const [p1, p2] = g.players;
  p1.hand = [[0, 1]];   // ni 2 ni 5: el pase revela un fallo de verdad
  p2.hand = [[6, 6]];
  g.currentPlayerIndex = 0;

  ok(g.passTurn(p1.id).success, 'Ana pasa (pozo vacío, sin jugada)');

  const shared = g.getSharedState();
  ok(shared.playerPassedOn, 'getSharedState difunde playerPassedOn');
  const fallos = shared.playerPassedOn[p1.id] || [];
  ok(fallos.includes(2) && fallos.includes(5), 'la mesa ve sobre qué números pasó Ana (2 y 5)');
  ok((g.getGameStateForPlayer(p2.id).playerPassedOn[p1.id] || []).includes(2), 'el rival lo recibe en su vista');
  ok((g.getSpectatorState().playerPassedOn[p1.id] || []).includes(2), 'y el espectador también');

  // playerPassedOn es un mapa INDEXADO POR JUGADOR, justo el caso que anticipa
  // el comentario de seatAliases: si la traducción dejara de recorrer claves,
  // el id de cuenta viajaría al cliente y el mapa no casaría con los asientos.
  const alias = require('./seatAliases');
  alias.registrarJugadores(g.roomId, g.players);
  const aliasado = alias.aliasarEstado(g.roomId, shared);
  ok(!aliasado.playerPassedOn[p1.id], 'el id de cuenta NO aparece como clave de playerPassedOn');
  ok((aliasado.playerPassedOn[alias.aliasDe(g.roomId, p1.id)] || []).includes(2), 'la tabla llega indexada por el alias del asiento');
  alias.olvidarSala(g.roomId);
})();

// ─── 2. La PRIMERA ficha de la ronda entra en el historial ───
(() => {
  const g = new DominoGame('LOG', null, { powersEnabled: false, maxPip: 6, drawEnabled: false });
  g.addPlayer('p1', 'Ana', 's1');
  g.addPlayer('p2', 'Beto', 's2');
  g.players.forEach(p => { p.ready = true; });
  g.startNewGame();

  const [p1, p2] = g.players;
  g.board = [];
  g.boneyard = [];
  g.moveLog = [];
  g.status = 'playing';
  p1.hand = [[3, 3], [6, 4]];
  p2.hand = [[3, 4], [0, 1]];
  g.currentPlayerIndex = 0;

  ok(g.playTile(p1.id, 0, 'left').success, 'Ana sale con el [3|3]');
  ok(g.moveLog.length === 1, 'la salida deja UNA entrada en el historial (antes: ninguna)');
  assert.deepStrictEqual(g.moveLog[0].tile, [3, 3], 'la entrada lleva la ficha de salida');
  ok(g.moveLog[0].action === 'play' && g.moveLog[0].side === 'left', 'con acción y lado, que es lo que consume la repetición');

  ok(g.playTile(p2.id, 0, 'right').success, 'Beto encadena el [3|4]');
  ok(g.playTile(p1.id, 0, 'right').success, 'Ana encadena el [6|4] volteado');
  assert.deepStrictEqual(reconstruir(g.moveLog), g.board, 'la reconstrucción del historial devuelve el tablero real');
  ok(true, 'la repetición arranca con la ficha de salida y no queda desplazada');
})();

// ─── 3. La entrada de pase apunta los extremos abiertos ───
(() => {
  const g = mesa();
  const [p1, p2] = g.players;
  p1.hand = [[0, 1]];
  p2.hand = [[6, 6]];
  g.currentPlayerIndex = 0;

  g.passTurn(p1.id);
  const entrada = g.moveLog[g.moveLog.length - 1];
  ok(entrada.action === 'pass', 'el pase queda registrado');
  assert.deepStrictEqual(entrada.ends, [2, 5], 'la entrada de pase lleva los dos extremos («pasó: no tenía 2 ni 5»)');

  // El historial se persiste con JSON.stringify (db.recordMatchEnd): un campo
  // `undefined` se perdería por el camino y la repetición no vería nada.
  const persistido = JSON.parse(JSON.stringify(g.moveLog)).pop();
  assert.deepStrictEqual(persistido.ends, [2, 5], 'los extremos sobreviven al viaje a la base de datos');
  ok(true, 'la crónica puede explicar el pase sin fiarlo a la memoria del jugador');
})();

// Un pase forzado por un poder NO revela nada: ni tabla ni extremos.
(() => {
  const g = mesa();
  const [p1, p2] = g.players;
  p1.hand = [[2, 6]];   // SÍ podría jugar por la izquierda
  p2.hand = [[0, 1]];
  g.currentPlayerIndex = 0;
  g.activeEffects.frozenEnd = 'both';
  g.activeEffects.frozenEndOwnerId = p2.id;

  ok(g.passTurn(p1.id).success, 'con ambos extremos congelados, pasar es legal');
  const entrada = g.moveLog[g.moveLog.length - 1];
  ok(entrada.ends === null, 'ese pase NO apunta extremos: no demuestra que le falten');
  ok(!g.playerPassedOn[p1.id], 'y tampoco entra en la tabla de fallos');
})();

// ─── 4. resultingEnd bajo Comodín predice el extremo REAL ───
(() => {
  // Ficha que no encaja en NINGÚN extremo: el caso para el que existe la carta.
  ['left', 'right'].forEach(lado => {
    const g = mesa();
    const p1 = g.players[0];
    p1.hand = [[0, 1]];
    g.currentPlayerIndex = 0;
    g.activeEffects.wildcardActive = true;

    const previsto = g.resultingEnd(p1.id, { tileIndex: 0, side: lado });
    ok(g.playTile(p1.id, 0, lado).success, `el Comodín coloca el [0|1] por la ${lado}`);
    const real = lado === 'left' ? g.getLeftEnd() : g.getRightEnd();
    ok(previsto === real, `resultingEnd acierta el extremo bajo Comodín por la ${lado} (previsto ${previsto}, real ${real})`);
  });
})();

// Sin Comodín la predicción es la de siempre (guardia de regresión).
(() => {
  const g = mesa();
  const p1 = g.players[0];
  p1.hand = [[2, 6]];   // encaja por la izquierda (extremo 2)
  g.currentPlayerIndex = 0;

  const previsto = g.resultingEnd(p1.id, { tileIndex: 0, side: 'left' });
  g.playTile(p1.id, 0, 'left');
  ok(previsto === 6 && previsto === g.getLeftEnd(), 'sin Comodín resultingEnd no cambia de comportamiento');
})();

// ─── 5. Los poderes que mueven fichas invalidan la deducción de pases ───
(() => {
  const g = mesa();
  const [p1, p2] = g.players;
  p2.hand = [[0, 1]];             // ni 2 ni 5
  p1.hand = [[2, 2], [6, 6]];
  g.currentPlayerIndex = 1;

  ok(g.passTurn(p2.id).success, 'Beto pasa: no tiene el 2 ni el 5');
  ok((g.playerPassedOn[p2.id] || []).includes(2), 'queda registrado que falla el 2');

  g.currentPlayerIndex = 0;
  p1.powers = [{ ...POWER_CATALOG.smuggle }];
  ok(g.usePowerCard(p1.id, 'smuggle', p2.id, 0).success, 'Ana le regala el [2|2] con Contrabando');
  ok(!(g.playerPassedOn[p2.id] || []).includes(2), 'el registro de Beto deja de decir que falla el 2');
  ok(g.hasValidMove(p2.id), 'y en efecto ahora SÍ tiene jugada');
})();

// Intercambio Mental: los fallos quedarían en el jugador equivocado.
(() => {
  const g = mesa();
  const [p1, p2] = g.players;
  p2.hand = [[0, 1]];
  p1.hand = [[2, 2]];
  g.currentPlayerIndex = 1;
  g.passTurn(p2.id);
  g.playerPassedOn[p1.id] = [4];  // un fallo antiguo de Ana

  g.currentPlayerIndex = 0;
  p1.powers = [{ ...POWER_CATALOG.mind_swap }];
  ok(g.usePowerCard(p1.id, 'mind_swap', p2.id, null).success, 'Ana intercambia su mano con la de Beto');
  ok(!g.playerPassedOn[p1.id] && !g.playerPassedOn[p2.id], 'al cambiar las manos se olvidan los fallos de AMBOS');
})();

// ─── 6. Azar sembrable: misma semilla, misma partida ───
function partidaSembrada(seed) {
  const g = new DominoGame('DET', null, { powersEnabled: false, maxPip: 6, seed });
  ['Rita', 'Chema', 'Yuri', 'Nando'].forEach(n => g.addBot(n, 'normal'));
  g.startNewGame();

  const jugadas = [];
  let pasos = 0;
  while (g.status === 'playing' && pasos < 400) {
    const asiento = g.currentPlayerIndex;
    const r = g.playBotTurn(g.getCurrentPlayer().id);
    jugadas.push({ asiento, accion: r.action, ficha: r.tile, lado: g.lastPlay ? g.lastPlay.side : null });
    pasos++;
  }
  return jugadas;
}

(() => {
  const g = new DominoGame('RNG', null, { rng: () => 0.42 });
  ok(g.rng() === 0.42, 'options.rng se inyecta tal cual (el patrón de choosePower)');

  const sembrada = new DominoGame('RNG', null, { seed: 7 });
  ok(typeof sembrada.rng === 'function' && sembrada.rng !== Math.random, 'options.seed construye un generador propio');

  const porDefecto = new DominoGame('RNG', null, {});
  ok(porDefecto.rng === Math.random, 'sin semilla el motor sigue usando Math.random: el comportamiento por defecto no cambia');

  const a = partidaSembrada(12345);
  const b = partidaSembrada(12345);
  ok(a.length > 5, `la partida sembrada avanza de verdad (${a.length} turnos)`);
  assert.deepStrictEqual(a, b, 'misma semilla ⇒ secuencia de jugadas idéntica');
  ok(true, 'dos partidas bot contra bot con la misma semilla son la misma partida');

  const c = partidaSembrada(999);
  ok(JSON.stringify(c) !== JSON.stringify(a), 'otra semilla ⇒ otra partida (el test no pasa por casualidad)');
})();

// ─── 7. La FORMA del jugador público: ni un campo de más ───
// Esta comprobación es la que evita que el estado engorde en silencio. Se
// actualiza A PROPÓSITO al retirar `inVoice` y `camOn`, que solo escribía el
// camino de voz «en sala» (voice_join/voice_leave/voice_cam), que ningún
// cliente usaba: eran constantes false y por eso el anillo de «está hablando»
// y los vídeos remotos no se encendían nunca. Quién está en la voz de la mesa
// viaja ahora por `table_voice`, aliasado y fuera del estado de partida.
(() => {
  const CAMPOS_JUGADOR = [
    'id', 'name', 'ready', 'score', 'team', 'isBot', 'difficulty',
    'handCount', 'shieldActive', 'powersCount', 'powers', 'hand'
  ].sort();

  const g = mesa();
  const [p1, p2] = g.players;

  const mio = g.getGameStateForPlayer(p1.id).players.find(p => p.id === p1.id);
  assert.deepStrictEqual(Object.keys(mio).sort(), CAMPOS_JUGADOR,
    'el jugador de getGameStateForPlayer expone EXACTAMENTE los campos acordados');

  const espectado = g.getSpectatorState().players.find(p => p.id === p2.id);
  assert.deepStrictEqual(Object.keys(espectado).sort(), CAMPOS_JUGADOR,
    'y la vista de espectador expone la misma forma');
  ok(true, 'la forma del jugador público está fijada: un campo nuevo rompe este test antes que la privacidad');

  ok(!('inVoice' in mio) && !('camOn' in mio), 'inVoice y camOn ya no viajan en el estado de partida');
})();

// Y la garantía vale para TODOS los juegos del registro, no solo para el
// dominó: un juego nuevo no puede reintroducir campos de voz por su cuenta.
(() => {
  require('./games/TicTacToeGame');
  require('./games/UnoGame');
  const GameRegistry = require('./core/GameRegistry');

  for (const { gameType } of GameRegistry.listGames()) {
    const g = GameRegistry.createGameInstance(gameType, `VOZ_${gameType}`, {});
    g.addPlayer('a', 'Ana', 'sa');
    g.addPlayer('b', 'Beto', 'sb');
    g.players.forEach(p => { p.ready = true; });
    if (g.status !== 'playing') g.startNewGame();

    const serializado = JSON.stringify([g.getGameStateForPlayer('a'), g.getSpectatorState()]);
    ok(!/"inVoice"|"camOn"/.test(serializado),
      `[${gameType}] el estado público no reintroduce campos de voz`);
  }
})();

console.log(`\n=== TODAS LAS PRUEBAS DE ESTADO PÚBLICO PASARON (${passed}) ===`);
