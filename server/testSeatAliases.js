// Pruebas de los alias de asiento (server/seatAliases.js).
//
// El id de CUENTA no debe salir de la sala: se sustituye por un alias efímero
// al serializar el estado y se traduce de vuelta al recibir órdenes. Lo que se
// prueba aquí es que la sustitución es exhaustiva (recorre el estado por VALOR,
// no una lista de campos) y que la ida y vuelta es fiel.

const assert = require('assert');
const alias = require('./seatAliases');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

const SALA = 'TEST';
const ANA = 'p_ana_cuenta';
const BETO = 'p_beto_cuenta';

// ─── Alias básicos ───
(() => {
  const a1 = alias.aliasDe(SALA, ANA);
  const a2 = alias.aliasDe(SALA, ANA);
  ok(a1 === a2, 'el alias de una cuenta es estable dentro de la sala');
  ok(a1 !== ANA && !a1.includes(ANA), 'el alias no contiene el id de cuenta');
  ok(alias.aliasDe(SALA, BETO) !== a1, 'dos cuentas tienen alias distintos');
  ok(alias.cuentaDe(SALA, a1) === ANA, 'el alias se traduce de vuelta a la cuenta');
})();

// ─── Aislamiento entre salas ───
(() => {
  const enTest = alias.aliasDe(SALA, ANA);
  const enOtra = alias.aliasDe('OTRA', ANA);
  ok(enTest !== enOtra, 'la MISMA cuenta tiene alias distinto en cada sala (no se puede correlacionar)');
  ok(alias.cuentaDe('OTRA', enTest) === enTest,
    'un alias de otra sala no se resuelve aquí (se devuelve tal cual)');
  alias.olvidarSala('OTRA');
})();

// ─── Valores que NO son jugadores ───
(() => {
  ok(alias.cuentaDe(SALA, 'left') === 'left', "'left' pasa sin tocar (extremo del tablero)");
  ok(alias.cuentaDe(SALA, 'right') === 'right', "'right' pasa sin tocar");
  ok(alias.cuentaDe(SALA, 'bot_1') === 'bot_1', 'un id desconocido pasa sin tocar');
  ok(alias.cuentaDe(SALA, undefined) === undefined, 'undefined no revienta');
  ok(alias.cuentaDe('SALA_NUEVA', 'lo_que_sea') === 'lo_que_sea', 'una sala sin tabla no revienta');
})();

// ─── Sustitución exhaustiva del estado ───
// Ésta es la garantía importante: se recorre por VALOR, así que un campo nuevo
// con un id dentro queda cubierto sin tocar el código de aliasado.
(() => {
  const aAna = alias.aliasDe(SALA, ANA);
  const aBeto = alias.aliasDe(SALA, BETO);

  const estado = {
    currentPlayerId: ANA,
    hostId: ANA,
    gameWinner: BETO,
    players: [
      { id: ANA, name: 'Ana', hand: [[6, 6]] },
      { id: BETO, name: 'Beto', hand: [] }
    ],
    activeEffects: { spyEyeOwnerId: ANA, spyEyeTargetId: BETO, frozenEnd: 'left' },
    moveLog: [{ playerId: BETO, tile: [3, 4] }],
    // Campo inventado: representa "el que alguien añadirá mañana".
    campoFuturoConId: ANA,
    anidadoProfundo: { a: { b: [{ c: BETO }] } }
  };

  const salida = alias.aliasarEstado(SALA, estado);
  const texto = JSON.stringify(salida);

  ok(!texto.includes(ANA), 'ningún rastro del id de cuenta de Ana en el estado');
  ok(!texto.includes(BETO), 'ningún rastro del id de cuenta de Beto');
  ok(salida.currentPlayerId === aAna, 'currentPlayerId aliasado');
  ok(salida.hostId === aAna, 'hostId aliasado');
  ok(salida.gameWinner === aBeto, 'gameWinner aliasado');
  ok(salida.players[0].id === aAna && salida.players[1].id === aBeto, 'players[].id aliasados');
  ok(salida.activeEffects.spyEyeOwnerId === aAna, 'ids dentro de activeEffects aliasados');
  ok(salida.moveLog[0].playerId === aBeto, 'ids dentro del historial aliasados');
  ok(salida.campoFuturoConId === aAna,
    'un campo NUEVO con un id también queda cubierto (por eso se recorre por valor)');
  ok(salida.anidadoProfundo.a.b[0].c === aBeto, 'ids anidados en profundidad, también');

  // Y lo que no es un id se respeta.
  ok(salida.players[0].name === 'Ana', 'los nombres no se tocan');
  ok(salida.activeEffects.frozenEnd === 'left', "'left' no se confunde con un id");
  assert.deepStrictEqual(salida.players[0].hand, [[6, 6]]);
  ok(true, 'las fichas llegan intactas');

  // El original no se modifica (se devuelve una copia).
  ok(estado.currentPlayerId === ANA, 'el estado original no se muta');
})();

// ─── Traducción de payloads entrantes ───
(() => {
  const aAna = alias.aliasDe(SALA, ANA);
  const entrada = { roomId: SALA, playerId: aAna, targetId: 'left', tileIndex: 2 };
  const salida = alias.traducirEntrada(SALA, entrada, ['playerId', 'targetId']);

  ok(salida.playerId === ANA, 'el alias entrante se traduce a la cuenta');
  ok(salida.targetId === 'left', "'left' sobrevive a la traducción");
  ok(salida.tileIndex === 2, 'los campos no listados no se tocan');
  ok(entrada.playerId === aAna, 'el payload original no se muta');
})();

// ─── Ciclo de vida ───
(() => {
  const antes = alias.aliasDe(SALA, ANA);
  alias.olvidarSala(SALA);
  const despues = alias.aliasDe(SALA, ANA);
  ok(antes !== despues, 'al destruir la sala los alias se regeneran (son efímeros)');
  alias.olvidarSala(SALA);
})();

console.log(`\n=== TODAS LAS PRUEBAS DE ALIAS DE ASIENTO PASARON (${passed}) ===`);
