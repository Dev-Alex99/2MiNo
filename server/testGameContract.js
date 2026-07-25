// Contrato multi-juego (BaseGame): garantiza que el orquestador (roomManager)
// puede pilotar CUALQUIER juego registrado sin conocer sus interioridades.
// Regresión de A3: pilotar un bot de tres en raya con la IA de dominó lanzaba
// `TypeError: game.getValidMoves is not a function` dentro de un setTimeout.
const assert = require('assert');
require('./games/TicTacToeGame');
require('./gameLogic');
const GameRegistry = require('./core/GameRegistry');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

// Construye una partida en curso de cada tipo, con un bot dentro.
function startedGame(gameType) {
  const g = GameRegistry.createGameInstance(gameType, `R_${gameType}`, { powersEnabled: true });
  g.addPlayer('h1', 'Humano', 's1');
  g.addBot('BotTest', 'normal');
  g.players.forEach(p => { p.ready = true; });
  if (g.status !== 'playing') g.startNewGame();
  return g;
}

for (const gameType of GameRegistry.listGames().map(x => x.gameType)) {
  const g = startedGame(gameType);

  // 1. El orquestador pregunta el jugador en turno SIN leer índices internos.
  ok(typeof g.getCurrentPlayer === 'function', `[${gameType}] implementa getCurrentPlayer()`);
  const cur = g.getCurrentPlayer();
  ok(cur && typeof cur.id === 'string', `[${gameType}] getCurrentPlayer() devuelve un jugador válido`);

  // 2. Declara si pilota sus propios bots.
  ok(typeof g.handlesOwnBots === 'function', `[${gameType}] implementa handlesOwnBots()`);

  // 3. Si NO los pilota, debe exponer playBotTurn y no lanzar al usarlo.
  if (!g.handlesOwnBots()) {
    ok(typeof g.playBotTurn === 'function', `[${gameType}] implementa playBotTurn() (no autopilota)`);
    const bot = g.players.find(p => p.isBot);
    g.currentPlayerIndex = g.players.indexOf(bot); // ponerle el turno al bot
    let res, threw = null;
    try { res = g.playBotTurn(bot.id); } catch (e) { threw = e; }
    ok(!threw, `[${gameType}] playBotTurn() no lanza excepción` + (threw ? ` (lanzó: ${threw.message})` : ''));
    ok(res && ['played', 'passed', 'skipped', 'none'].includes(res.action), `[${gameType}] playBotTurn() devuelve una acción válida`);
  } else {
    ok(true, `[${gameType}] autopilota sus bots (el orquestador no debe programarlos)`);
  }

  // 4. forceTurn devuelve el contrato { action, playerName, drew } — lo que
  //    armTurnTimer necesita para narrar el timeout sin producir NaN/undefined.
  const g2 = startedGame(gameType);
  const forced = g2.forceTurn();
  ok(forced && typeof forced === 'object', `[${gameType}] forceTurn() devuelve un objeto (no booleano)`);
  ok(['played', 'passed', 'skipped', 'none'].includes(forced.action), `[${gameType}] forceTurn().action es válido: ${forced && forced.action}`);
  ok(typeof forced.drew === 'number', `[${gameType}] forceTurn().drew es numérico (evita NaN en el mensaje)`);
}

console.log(`\n=== TODAS LAS PRUEBAS DEL CONTRATO MULTI-JUEGO PASARON (${passed}) ===`);
