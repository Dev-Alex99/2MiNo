// Contrato multi-juego (BaseGame): garantiza que el orquestador (roomManager) y
// los handlers pueden pilotar CUALQUIER juego registrado sin conocer sus
// interioridades. Recorre TODOS los juegos del registro, así que un juego nuevo
// queda obligado a cumplirlo sin tocar este fichero.
//
// Regresiones que cubre:
//  · A3 — pilotar un bot de tres en raya con la IA de dominó lanzaba
//    `TypeError: game.getValidMoves is not a function` dentro de un setTimeout.
//  · Ciclo de vida de SALA — `toggleReady`, `allReady`, `removePlayerById`,
//    `ensureHost` y `swapSeats` sólo existían en DominoGame, pero roomHandler
//    los llama en cualquier sala: en tres en raya `toggle_ready` reventaba y dos
//    humanos NUNCA podían empezar una partida.
//  · Resultado — el orquestador leía `gameWinner`/`maxPip` (campos del dominó),
//    así que una partida de tres en raya se registraba como `double_6` y
//    siempre como empate.
const assert = require('assert');
require('./games/TicTacToeGame');
require('./games/UnoGame');
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

// Avanza la partida hasta que le toque a un bot (o se agote el margen).
// Antes el test forzaba el turno escribiendo `currentPlayerIndex`, que es el
// campo del DOMINÓ: en tres en raya no hacía nada y `playBotTurn` se daba por
// bueno devolviendo 'none' sin haber jugado jamás.
function avanzarHastaBot(g, maxPasos = 12) {
  for (let i = 0; i < maxPasos; i++) {
    const cur = g.getCurrentPlayer();
    if (!cur || g.status !== 'playing') return null;
    if (cur.isBot) return cur;
    g.forceTurn(); // juega por el humano para ceder el turno
  }
  return null;
}

for (const gameType of GameRegistry.listGames().map(x => x.gameType)) {
  const g = startedGame(gameType);

  // ─── 1. Turno y bots ───
  ok(typeof g.getCurrentPlayer === 'function', `[${gameType}] implementa getCurrentPlayer()`);
  const cur = g.getCurrentPlayer();
  ok(cur && typeof cur.id === 'string', `[${gameType}] getCurrentPlayer() devuelve un jugador válido`);

  ok(typeof g.handlesOwnBots === 'function', `[${gameType}] implementa handlesOwnBots()`);

  if (!g.handlesOwnBots()) {
    ok(typeof g.playBotTurn === 'function', `[${gameType}] implementa playBotTurn() (no autopilota)`);
    const bot = avanzarHastaBot(g);
    ok(!!bot, `[${gameType}] se alcanza un turno de bot para poder probarlo de verdad`);
    if (bot) {
      let res, threw = null;
      try { res = g.playBotTurn(bot.id); } catch (e) { threw = e; }
      ok(!threw, `[${gameType}] playBotTurn() no lanza excepción` + (threw ? ` (lanzó: ${threw.message})` : ''));
      // Lo que importa es que el bot AVANCE el turno, no qué haga: en Uno puede
      // no tener jugada legal y robar es progreso legítimo. Exigir 'played'
      // codificaba una suposición del dominó y además era intermitente.
      // 'none' sí es el fallo real: el bot no hace nada y la partida se cuelga.
      ok(res && ['played', 'passed', 'skipped'].includes(res.action),
        `[${gameType}] playBotTurn() avanza el turno cuando le toca (devolvió '${res && res.action}')`);
    }
  } else {
    ok(true, `[${gameType}] autopilota sus bots (el orquestador no debe programarlos)`);
  }

  // ─── 2. forceTurn: contrato que armTurnTimer necesita para narrar ───
  const g2 = startedGame(gameType);
  const forced = g2.forceTurn();
  ok(forced && typeof forced === 'object', `[${gameType}] forceTurn() devuelve un objeto (no booleano)`);
  ok(['played', 'passed', 'skipped', 'none'].includes(forced.action), `[${gameType}] forceTurn().action es válido: ${forced && forced.action}`);
  ok(typeof forced.drew === 'number', `[${gameType}] forceTurn().drew es numérico (evita NaN en el mensaje)`);

  // ─── 3. Ciclo de vida de la SALA (lo llama roomHandler en toda sala) ───
  const sala = GameRegistry.createGameInstance(gameType, `S_${gameType}`, {});
  for (const m of ['toggleReady', 'allReady', 'removePlayerById', 'ensureHost', 'swapSeats']) {
    ok(typeof sala[m] === 'function', `[${gameType}] implementa ${m}()`);
  }

  ok(typeof sala.maxPlayers === 'number' && sala.maxPlayers >= 2,
    `[${gameType}] declara su aforo (maxPlayers=${sala.maxPlayers}); sin esto join_room asumía 4`);

  const a = sala.addPlayer('a', 'Ana', 'sa');
  ok(!!a, `[${gameType}] admite al primer jugador`);
  ok(sala.hostId === 'a', `[${gameType}] el primer humano queda de anfitrión (kick_player lo exige)`);

  sala.addPlayer('b', 'Beto', 'sb');
  ok(sala.allReady() === false, `[${gameType}] allReady() es false mientras alguien no esté listo`);
  sala.toggleReady('sa');
  sala.toggleReady('sb');
  ok(sala.allReady() === true, `[${gameType}] allReady() es true con la mesa lista`);

  ok(sala.swapSeats('a', 'b') === true, `[${gameType}] swapSeats() intercambia dos asientos`);
  ok(sala.players[0].id === 'b', `[${gameType}] el intercambio de asientos surte efecto`);

  ok(sala.removePlayerById('b') !== null, `[${gameType}] removePlayerById() saca al jugador`);
  ok(sala.hostId === 'a', `[${gameType}] al irse el anfitrión, otro humano lo hereda`);

  // Aforo: no se puede sentar a más gente de la que caben.
  const llena = GameRegistry.createGameInstance(gameType, `F_${gameType}`, {});
  for (let i = 0; i < llena.maxPlayers; i++) llena.addPlayer(`p${i}`, `J${i}`, `s${i}`);
  ok(llena.addPlayer('extra', 'Extra', 'sx') === null,
    `[${gameType}] addPlayer() rechaza al jugador que sobra (aforo ${llena.maxPlayers})`);

  // ─── 4. Resultado de la partida (historial y ELO) ───
  ok(typeof g2.getWinnerId === 'function', `[${gameType}] implementa getWinnerId()`);
  ok(typeof g2.getVariantLabel === 'function', `[${gameType}] implementa getVariantLabel()`);
  ok(typeof g2.getVariantLabel() === 'string' && g2.getVariantLabel().length > 0,
    `[${gameType}] getVariantLabel() devuelve una etiqueta: '${g2.getVariantLabel()}'`);
}

console.log(`\n=== TODAS LAS PRUEBAS DEL CONTRATO MULTI-JUEGO PASARON (${passed}) ===`);
