// Pruebas de la economía: ELO clasificatorio (suma cero) y monedas por partida.
//
// El fallo que cubren: antes el ELO era un ±fijo (+25 al ganador, −10 al
// perdedor) con suelo `GREATEST(1000, ...)`. Cada partida INYECTABA 15 puntos,
// así que dos cuentas alternando victorias subían las dos sin límite y la
// clasificación medía constancia, no habilidad. Lo que se prueba aquí es la
// propiedad que lo impide: lo que gana uno es exactamente lo que pierde el otro.

const assert = require('assert');
const { computeEloDelta, coinsForMatch, ELO_K, ELO_FLOOR } = require('./db');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

// ─── Suma cero ───
// computeEloDelta devuelve lo que gana A; el mismo valor se le resta a B.
const totalSistema = (Ra, Rb, scoreA) => {
  const d = computeEloDelta(Ra, Rb, scoreA);
  return (Ra + d) + (Rb - d) - (Ra + Rb); // variación del total del sistema
};

ok(totalSistema(1200, 1200, 1) === 0, 'una victoria no cambia el ELO total del sistema');
ok(totalSistema(1500, 1100, 0) === 0, 'una derrota del favorito tampoco lo cambia');
ok(totalSistema(1200, 1200, 0.5) === 0, 'un empate tampoco lo cambia');
ok(totalSistema(900, 2400, 1) === 0, 'ni siquiera un resultado extremo inyecta puntos');

// ─── El farmeo con dos cuentas ya no renta ───
// A gana, luego gana B. Antes: +15 a cada una por cada 2 partidas.
(() => {
  let a = 1200, b = 1200;
  for (let i = 0; i < 50; i++) {
    const d1 = computeEloDelta(a, b, 1); a += d1; b -= d1;   // gana A
    const d2 = computeEloDelta(a, b, 0); a += d2; b -= d2;   // gana B
  }
  ok(a + b === 2400, 'tras 100 partidas alternas el total sigue siendo 2400 (antes: +1500)');
  // La propiedad que mata el farmeo: es IMPOSIBLE que suban las dos. Lo que
  // gana una es exactamente lo que pierde la otra, así que un alt solo puede
  // "regalar" su ELO, nunca crearlo. (Antes ambas subían +750 en estas 100.)
  ok(!(a > 1200 && b > 1200), 'las dos cuentas no pueden subir a la vez');
  ok((a - 1200) === -(b - 1200), 'lo que sube una es exactamente lo que baja la otra');
})();

// ─── Comportamiento Elo estándar ───
ok(computeEloDelta(1200, 1200, 1) === Math.round(ELO_K / 2),
  `entre iguales, ganar suma K/2 (${Math.round(ELO_K / 2)})`);
ok(computeEloDelta(1200, 1200, 0) === -Math.round(ELO_K / 2), 'entre iguales, perder resta lo mismo');
ok(computeEloDelta(1200, 1200, 0.5) === 0, 'un empate entre iguales no mueve nada');

const ganarAlDebil = computeEloDelta(2000, 1000, 1);
const ganarAlFuerte = computeEloDelta(1000, 2000, 1);
ok(ganarAlDebil >= 0 && ganarAlDebil <= 2, 'ganar a alguien muy inferior apenas suma');
ok(ganarAlFuerte >= 30, 'ganar a alguien muy superior suma mucho');
ok(ganarAlFuerte > ganarAlDebil, 'la recompensa escala con la dificultad del rival');

const perderConElDebil = computeEloDelta(2000, 1000, 0);
ok(perderConElDebil <= -30, 'perder contra alguien muy inferior cuesta caro');

// El empate favorece al de menos ELO.
ok(computeEloDelta(1000, 2000, 0.5) > 0, 'empatar contra alguien muy superior suma');
ok(computeEloDelta(2000, 1000, 0.5) < 0, 'empatar contra alguien muy inferior resta');

// ─── Suelo: no se pueden inventar puntos ───
(() => {
  // Dos jugadores en el suelo: sin el recorte, A ganaría K/2 puntos que B no
  // tiene → serían puntos inventados.
  ok(computeEloDelta(ELO_FLOOR, ELO_FLOOR, 1) === 0,
    'si el perdedor ya está en el suelo, el ganador no cobra (no se inyectan puntos)');

  // B puede pagar solo 3 puntos: A cobra exactamente 3, no los 16 de tabla.
  const Rb = ELO_FLOOR + 3;
  const d = computeEloDelta(ELO_FLOOR, Rb, 1);
  ok(d === 3, `el ganador cobra solo lo que el perdedor puede pagar (${d}, no ${Math.round(ELO_K / 2)})`);
  ok(totalSistema(ELO_FLOOR, Rb, 1) === 0, 'el recorte por suelo mantiene la suma cero');
  ok(Rb - d === ELO_FLOOR, 'el perdedor se queda justo en el suelo, nunca por debajo');
})();

// ─── Robustez ───
ok(computeEloDelta(undefined, undefined, 1) === Math.round(ELO_K / 2),
  'un ELO ausente se trata como el valor por defecto (no produce NaN)');
ok(Number.isInteger(computeEloDelta(1234, 1567, 1)), 'el delta siempre es entero');

// ─── Monedas: solo pagan las partidas con al menos dos humanos ───
// Antes cobraba TODA partida terminada y sin tope: un script que abriera sala,
// metiera un bot y la cerrara en bucle compraba la tienda entera en minutos.
ok(coinsForMatch({ isWinner: true, isTie: false, humanCount: 1 }) === 0,
  'ganar a un bot no da monedas (era el grifo del farmeo automatizado)');
ok(coinsForMatch({ isWinner: false, isTie: false, humanCount: 1 }) === 0, 'perder contra un bot tampoco');
ok(coinsForMatch({ isWinner: false, isTie: true, humanCount: 1 }) === 0, 'empatar contra un bot tampoco');

ok(coinsForMatch({ isWinner: true, isTie: false, humanCount: 2 }) === 50, 'con 2 humanos, ganar sigue dando 50');
ok(coinsForMatch({ isWinner: false, isTie: false, humanCount: 2 }) === 10, 'con 2 humanos, perder sigue dando 10');
ok(coinsForMatch({ isWinner: false, isTie: true, humanCount: 2 }) === 25, 'con 2 humanos, empatar sigue dando 25');
ok(coinsForMatch({ isWinner: true, isTie: false, humanCount: 4 }) === 50, 'una mesa de 4 humanos paga igual');

// El farmeo automatizado deja de rentar por completo.
(() => {
  let monedas = 0;
  for (let i = 0; i < 1000; i++) monedas += coinsForMatch({ isWinner: true, isTie: false, humanCount: 1 });
  ok(monedas === 0, '1.000 partidas contra bots dan 0 monedas (antes: 50.000, la tienda entera x6)');
})();

console.log(`\n=== TODAS LAS PRUEBAS DE ECONOMÍA PASARON (${passed}) ===`);
