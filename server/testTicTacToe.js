const GameRegistry = require('./core/GameRegistry');
require('./games/TicTacToeGame');
const assert = require('assert');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

console.log('=== PRUEBAS DE TRES EN RAYA ===');

// ─── Registro y arranque ───
const entry = GameRegistry.get('tictactoe');
ok(entry !== null, 'registrado en GameRegistry');
ok(entry.metadata.name === 'Tres en Raya', 'con su nombre en los metadatos');

const game = GameRegistry.createGameInstance('tictactoe', 'room_test_1', {});
game.addPlayer('p1', 'Alice');
game.addPlayer('p2', 'Bob');
ok(game.players.length === 2, 'se sientan dos jugadores');
ok(game.addPlayer('p3', 'Carol') === null, 'el tercero NO entra: la mesa es de dos');

ok(game.startNewGame() === true, 'la partida arranca');
ok(game.status === 'playing', 'queda en curso');
ok(game.symbols.p1 === 'X' && game.symbols.p2 === 'O', 'símbolos X/O asignados');

// ─── Victoria y resultado ───
game.handleAction('p1', 'move', { index: 0 });
game.handleAction('p2', 'move', { index: 1 });
game.handleAction('p1', 'move', { index: 3 });
game.handleAction('p2', 'move', { index: 4 });
const winAction = game.handleAction('p1', 'move', { index: 6 });

ok(winAction.success === true, 'la jugada ganadora se acepta');
ok(game.status === 'game_ended', 'la partida termina');
ok(game.winner === 'X', 'gana X');
assert.deepStrictEqual(game.winningLine, [0, 3, 6]);
ok(true, 'la línea ganadora es la columna [0, 3, 6]');
ok(game.scores.X === 1, 'el marcador de X sube');

/**
 * El historial y el ELO esperan un playerId. El ganador del tres en raya es un
 * SÍMBOLO, así que sin traducirlo toda partida se guardaba como empate.
 */
ok(game.getWinnerId() === 'p1', 'getWinnerId() traduce el símbolo ganador a su playerId');
ok(game.getVariantLabel() === 'tictactoe', 'la partida se registra como tres en raya, no como double_6');

// ─── Errores como claves i18n ───
// En crudo llegaban al cliente en español y se mostraban sin traducir.
(() => {
  const g = GameRegistry.createGameInstance('tictactoe', 'r_err', {});
  g.addPlayer('a', 'Ana'); g.addPlayer('b', 'Beto');
  ok(g.handleAction('a', 'move', { index: 0 }).error === 'srv.err.gameNotRunning',
    'jugar sin partida en curso devuelve una CLAVE, no una frase');
  g.startNewGame();
  const enTurno = g.players[g.currentPlayerIdx].id;
  const fuera = enTurno === 'a' ? 'b' : 'a';
  ok(g.handleAction(fuera, 'move', { index: 0 }).error === 'srv.err.notYourTurn', 'jugar fuera de turno');
  ok(g.handleAction(enTurno, 'move', { index: 99 }).error === 'srv.err.badCell', 'casilla fuera del tablero');
  g.handleAction(enTurno, 'move', { index: 0 });
  const otro = enTurno === 'a' ? 'b' : 'a';
  ok(g.handleAction(otro, 'move', { index: 0 }).error === 'srv.err.cellTaken', 'casilla ocupada');
})();

// ─── Bots ───
(() => {
  const g = GameRegistry.createGameInstance('tictactoe', 'r_bot', {});
  g.addPlayer('p1', 'Alice');
  const bot = g.addBot('Bot', 'normal');
  ok(bot !== null, 'se añade un bot');
  ok(g.status === 'waiting',
    'añadir el bot NO arranca la partida solo: se espera a que el humano esté listo');
  ok(g.handlesOwnBots() === false,
    'el bot lo pilota el orquestador (antes movía en un timer privado que nadie difundía)');
  ok(g.addBot('Bot2', 'normal') === null, 'no cabe un tercer participante');
})();

// ─── La IA: los cuatro niveles hacen cosas distintas ───
//
// Antes el motor comparaba `difficulty === 'easy'` mientras el cliente mandaba
// 'facil'/'normal'/'dificil'/'maestro': ningún nivel entraba en su rama y los
// cuatro jugaban exactamente igual.

/** Juega una partida completa. `rival` decide la jugada del oponente. */
function partida(nivelBot, rival, botEmpieza) {
  const g = GameRegistry.createGameInstance('tictactoe', 'sim', {});
  g.addPlayer('bot', 'Bot');
  g.addPlayer('hum', 'Humano');
  g.startNewGame();
  // startNewGame alterna quién abre según la ronda; se fuerza para poder probar
  // el bot abriendo Y respondiendo.
  g.currentPlayerIdx = botEmpieza ? 0 : 1;

  let guarda = 0;
  while (g.status === 'playing' && guarda++ < 10) {
    const turno = g.getCurrentPlayer();
    const libres = g.casillasLibres();
    if (!libres.length) break;
    const idx = turno.id === 'bot'
      ? g.elegirJugada(g.symbols.bot, nivelBot)
      : rival(g, libres);
    g.handleAction(turno.id, 'move', { index: idx });
  }
  if (g.winner === 'draw' || !g.winner) return 'empate';
  return g.winner === g.symbols.bot ? 'bot' : 'rival';
}

const alAzar = (g, libres) => libres[Math.floor(Math.random() * libres.length)];

(() => {
  // LA propiedad que define el nivel difícil: con juego perfecto es imposible
  // ganarle. Lo máximo a lo que puede aspirar el rival es al empate.
  let derrotas = 0;
  const PARTIDAS = 150;
  for (let i = 0; i < PARTIDAS; i++) {
    if (partida('dificil', alAzar, i % 2 === 0) === 'rival') derrotas++;
  }
  ok(derrotas === 0, `el bot DIFÍCIL no pierde ni una de ${PARTIDAS} partidas (abriendo y respondiendo)`);
})();

(() => {
  // Dos jugadores perfectos siempre empatan.
  const perfectoRival = (g) => g.mejorJugadaMinimax(g.symbols.hum);
  let noEmpates = 0;
  for (let i = 0; i < 20; i++) {
    if (partida('dificil', perfectoRival, i % 2 === 0) !== 'empate') noEmpates++;
  }
  ok(noEmpates === 0, 'difícil contra difícil termina SIEMPRE en empate');
})();

(() => {
  // Fácil debe ser ganable de verdad: contra un rival perfecto pierde a menudo.
  const perfectoRival = (g) => g.mejorJugadaMinimax(g.symbols.hum);
  let derrotasDelBot = 0;
  for (let i = 0; i < 30; i++) {
    if (partida('facil', perfectoRival, false) === 'rival') derrotasDelBot++;
  }
  ok(derrotasDelBot > 0, `el bot FÁCIL sí es batible (perdió ${derrotasDelBot}/30 contra juego perfecto)`);
})();

(() => {
  // Fácil juega al azar: repetir la misma posición debe dar respuestas distintas.
  const respuestas = new Set();
  for (let i = 0; i < 40; i++) {
    const g = GameRegistry.createGameInstance('tictactoe', 'r_azar', {});
    g.addPlayer('bot', 'Bot'); g.addPlayer('h', 'H');
    g.startNewGame();
    respuestas.add(g.elegirJugada('X', 'facil'));
  }
  ok(respuestas.size > 1, `el nivel fácil varía sus jugadas (${respuestas.size} casillas distintas)`);
})();

(() => {
  // Normal aplica su heurística: en tablero vacío toma el centro y ante una
  // amenaza la bloquea.
  const g = GameRegistry.createGameInstance('tictactoe', 'r_heur', {});
  g.addPlayer('bot', 'Bot'); g.addPlayer('h', 'H');
  g.startNewGame();
  ok(g.elegirJugada('X', 'normal') === 4, 'el nivel normal abre en el centro');

  g.board = ['O', 'O', null, null, 'X', null, null, null, null];
  ok(g.elegirJugada('X', 'normal') === 2, 'el nivel normal BLOQUEA la línea del rival');

  g.board = ['X', 'X', null, null, 'O', null, null, 'O', null];
  ok(g.elegirJugada('X', 'normal') === 2, 'y prefiere GANAR antes que bloquear');
})();

(() => {
  // La profundidad en la puntuación hace que remate ya, en vez de alargar una
  // partida ganada (que se ve como si el bot jugara mal).
  const g = GameRegistry.createGameInstance('tictactoe', 'r_prof', {});
  g.addPlayer('bot', 'Bot'); g.addPlayer('h', 'H');
  g.startNewGame();
  g.board = ['X', 'X', null, 'O', 'O', null, null, null, null];
  ok(g.mejorJugadaMinimax('X') === 2, 'el minimax remata en cuanto puede ganar');

  g.board = ['O', 'O', null, 'X', null, null, null, null, null];
  ok(g.mejorJugadaMinimax('X') === 2, 'y bloquea cuando la amenaza es del rival');
})();

console.log(`\n=== TODAS LAS PRUEBAS DE TRES EN RAYA PASARON (${passed}) ===`);
