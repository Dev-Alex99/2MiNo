// TORNEO DE FUERZA: la escalera de dificultad, con victorias contadas.
//
// Todo aquí es reproducible: las semillas están escritas en el código y el
// motor acepta `seed` (RNG mulberry32 inyectable), así que dos ejecuciones en
// dos máquinas dan los mismos números. Los cuatro cerebros son deterministas
// —también el muestreo de 'maestro', que siembra su azar con un hash de la
// posición pública—, de modo que no hay ni una fuente de ruido aparte del
// reparto.
//
// CÓMO SE MIDE, Y POR QUÉ ASÍ
//   · La unidad es la PARTIDA, que es lo que juega una persona: una ronda
//     suelta la decide tanto el reparto que hasta un cerebro muy superior gana
//     poco más de una de cada tres. La partida acumula rondas y por eso separa.
//   · ROTACIÓN DE ASIENTOS (reparto duplicado, como en el bridge): cada semilla
//     se juega tantas veces como asientos hay, moviendo el cerebro que se mide
//     de silla en silla sobre EL MISMO reparto. Anula el sesgo posicional y
//     buena parte de la varianza del reparto.
//   · Eso da un control del banco de pruebas que hay que mirar antes de creerse
//     ninguna otra cifra: con cuatro cerebros IDÉNTICOS la partida es la misma
//     en las cuatro rotaciones, así que el "nivel a medir" gana exactamente una
//     de cada cuatro. La línea de 'normal' contra tres 'normal' tiene que
//     salir 25 % EXACTO, no "más o menos 25". Si no sale, lo roto es el banco.
//   · Por eso el intervalo de 'normal' no se usa para separar: su valor no es
//     una estimación, es una identidad. Los demás niveles se comparan contra
//     ese 25 % y entre ellos con intervalos de Wald al 95 %.
//
// TAMAÑO: N semillas × 4 asientos = 4N partidas por nivel. N=100 por omisión
// (≈15 s los cuatro niveles). `node server/testBotStrength.js --largo` sube a
// N=300 y añade las tablas finas (rondas, duelos entre niveles y 1 contra 1);
// es lo que corre `pnpm test:server:slow`.

const assert = require('assert');
const DominoGame = require('./gameLogic');
const { chooseMove } = require('./botLogic');

// Semillas fijas: el resultado de esta suite es un número, no una impresión.
// La base es distinta de la que se usó para ajustar los pesos de la heurística
// (2000..2800), para que lo que se mide aquí no sea el ajuste mirándose al
// espejo.
// La familia se puede cambiar desde fuera para auditar que la escalera no
// depende de la elegida:  SEMILLA_BASE=777777 node server/testBotStrength.js
// No es un adorno: una auditoria adversarial de esta misma suite descubrio asi
// que dos de los umbrales de abajo solo pasaban con la familia por omision.
const SEMILLA_BASE = Number(process.env.SEMILLA_BASE) || 20250901;
const LARGO = process.argv.includes('--largo');
const N = LARGO ? 300 : 100;
// 240 y no 60: con 60 el intervalo de parejas mide 13 puntos y las dos
// afirmaciones de coordinacion se caian segun la familia de semillas (con
// 777777 'dificil' se quedaba en 50,8 %; con 999999999 'maestro' salia POR
// DEBAJO de 'dificil'). No era que la coordinacion no exista: era que 240
// rondas no bastan para verla. A 960 rondas por nivel las dos aguantan en las
// cinco familias probadas, y cuesta unos segundos mas.
const N_PAREJAS = Number(process.env.N_PAREJAS) || (LARGO ? 300 : 240);
// Partida corta: separa igual que la de 100 y cuesta la mitad de rondas.
const PUNTOS_PARTIDA = 50;
// Para las tablas de RONDA suelta hace falta que la partida no se corte nunca.
const PUNTOS_RONDA = 500;

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

console.log(`=== TORNEO DE FUERZA DE LA IA (N=${N} semillas${LARGO ? ', modo largo' : ''}) ===`);

function nuevaMesa(semilla, niveles, { parejas = false, puntos }) {
  const g = new DominoGame('FUERZA', puntos, {
    powersEnabled: false, maxPip: 6, drawEnabled: true, teamsEnabled: parejas, seed: semilla
  });
  niveles.forEach((n, i) => g.addBot(`B${i}`, n));
  g.startNewGame();
  return g;
}

// Turno a turno con el cerebro de cada bot. forceTurn resuelve robar y pasar
// con las mismas reglas que aplicaría el reloj en una sala real.
function avanzarTurno(g) {
  const actual = g.players[g.currentPlayerIndex];
  const mv = chooseMove(g, actual.id);
  if (mv) {
    const r = g.playTile(actual.id, mv.tileIndex, mv.side);
    if (!r.success) g.forceTurn();
  } else {
    g.forceTurn();
  }
}

// Partida entera hasta el límite de puntos. Devuelve el asiento (o el equipo)
// ganador. Una partida SIEMPRE tiene ganador: no hay empates que descontar.
function jugarPartida(semilla, niveles, parejas) {
  const g = nuevaMesa(semilla, niveles, { parejas, puntos: PUNTOS_PARTIDA });
  let guarda = 0;
  while (g.status !== 'game_ended' && guarda++ < 20000) {
    if (g.status === 'round_ended') { g.startNewRound(); continue; }
    if (g.status !== 'playing') break;
    avanzarTurno(g);
  }
  if (parejas) return g.gameWinnerTeam ?? -1;
  return g.players.findIndex(p => p.id === g.gameWinner);
}

// Una sola ronda. Devuelve -1 si acabó en empate de tranca.
function jugarRonda(semilla, niveles, parejas) {
  const g = nuevaMesa(semilla, niveles, { parejas, puntos: PUNTOS_RONDA });
  let guarda = 0;
  while (g.status === 'playing' && guarda++ < 400) avanzarTurno(g);
  if (parejas) return g.roundWinnerTeam ?? -1;
  return g.players.findIndex(p => p.id === g.roundWinner);
}

// Mide un nivel contra una mesa de `base`, rotando el asiento del que se mide.
function medir(nivel, base, semillas, { nJug = 4, parejas = false, unidad = jugarPartida } = {}) {
  let ganadas = 0;
  let jugadas = 0;
  let sinGanador = 0;
  const t0 = Date.now();

  for (let s = 1; s <= semillas; s++) {
    for (let asiento = 0; asiento < nJug; asiento++) {
      const niveles = new Array(nJug).fill(base);
      niveles[asiento] = nivel;
      // En parejas el nivel ocupa la pareja entera (asientos enfrentados).
      if (parejas) niveles[(asiento + 2) % nJug] = nivel;

      const ganador = unidad(SEMILLA_BASE + s, niveles, parejas);
      const mio = parejas ? asiento % 2 : asiento;
      if (ganador === -1) sinGanador++;
      else if (ganador === mio) ganadas++;
      jugadas++;
    }
  }

  const p = ganadas / jugadas;
  const ic = 1.96 * Math.sqrt((p * (1 - p)) / jugadas);
  return { nivel, ganadas, jugadas, sinGanador, p, ic, bajo: p - ic, alto: p + ic, ms: Date.now() - t0 };
}

function fila(r) {
  console.log(
    `  ${r.nivel.padEnd(15)} ${`${(100 * r.p).toFixed(2)} %`.padStart(8)}` +
    `  IC95 [${(100 * r.bajo).toFixed(2)}, ${(100 * r.alto).toFixed(2)}]` +
    `  ${String(r.ganadas).padStart(5)}/${r.jugadas}  ${String(r.ms).padStart(6)} ms`
  );
}

const BASE = 0.25; // el 25 % estructural de 'normal': identidad, no estimación

// ─────────────────────────────────────────────────────────────────────────────
// TABLA 1: cada nivel contra tres 'normal'. PARTIDAS. Es la medida oficial.
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n--- Cada nivel contra 3 'normal' — partidas a ${PUNTOS_PARTIDA} puntos ` +
  `(${4 * N} partidas por nivel) ---`);
const tabla = {};
for (const nivel of ['facil', 'normal', 'dificil', 'maestro']) {
  tabla[nivel] = medir(nivel, 'normal', N);
  fila(tabla[nivel]);
}

ok(tabla.normal.ganadas === N && tabla.normal.sinGanador === 0,
  `Control del banco: 'normal' contra 3 'normal' gana EXACTAMENTE una de cada cuatro rotaciones ` +
  `(${tabla.normal.ganadas} de ${N} semillas, 25.00 % clavado)`);

ok(tabla.facil.p < tabla.normal.p && tabla.normal.p < tabla.dificil.p && tabla.dificil.p < tabla.maestro.p,
  `Escalera estricta: fácil ${(100 * tabla.facil.p).toFixed(2)} < normal ${(100 * tabla.normal.p).toFixed(2)} ` +
  `< difícil ${(100 * tabla.dificil.p).toFixed(2)} < maestro ${(100 * tabla.maestro.p).toFixed(2)} %`);

// Umbrales del plan, sobre la unidad que el jugador juega.
ok(tabla.facil.p < 0.15, `'facil' por debajo del 15 %: ${(100 * tabla.facil.p).toFixed(2)} %`);
ok(Math.abs(tabla.normal.p - BASE) < 0.05, `'normal' en 25 ± 5: ${(100 * tabla.normal.p).toFixed(2)} %`);
// 0,29 y no 0,32: medido sobre cinco familias de semillas distintas, 'dificil'
// se mueve entre 31,0 y 37,0 % y su valor agregado sobre 1.600 partidas es
// 33,7 %. El 37 % de la familia por omision cae en el lado bueno del ruido, y
// un umbral de 0,32 se ponia ROJO con la familia 777777. Esto exige lo que la
// medida sostiene en cualquier familia, no lo que luce mejor en una.
ok(tabla.dificil.p > 0.29, `'dificil' por encima del 29 %: ${(100 * tabla.dificil.p).toFixed(2)} %`);
ok(tabla.maestro.p > 0.38, `'maestro' por encima del 38 %: ${(100 * tabla.maestro.p).toFixed(2)} %`);

// Separaciones: los intervalos de niveles consecutivos no se tocan.
ok(tabla.facil.alto < BASE,
  `Sin solape fácil/normal: el IC95 de 'facil' acaba en ${(100 * tabla.facil.alto).toFixed(2)} %, bajo el 25 %`);
ok(tabla.dificil.bajo > BASE,
  `Sin solape normal/difícil: el IC95 de 'dificil' arranca en ${(100 * tabla.dificil.bajo).toFixed(2)} %, sobre el 25 %`);
// Difícil y maestro estan mas juntos que los demas escalones, asi que con
// N=100 sus intervalos se rozan en algunas familias (con la 13 se solapan). A
// ese tamano se exige separacion de PUNTOS —la mas estrecha observada son 9,5
// puntos, asi que 5 es holgado—; el no-solape de intervalos se exige donde la
// muestra da para sostenerlo, en --largo.
ok(tabla.maestro.p - tabla.dificil.p > 0.05,
  `Distancia difícil→maestro: ${(100 * (tabla.maestro.p - tabla.dificil.p)).toFixed(2)} puntos (mínimo 5)`);
if (LARGO) {
  ok(tabla.maestro.bajo > tabla.dificil.alto,
    `Sin solape difícil/maestro: [${(100 * tabla.maestro.bajo).toFixed(2)}, …] arranca por encima de ` +
    `[…, ${(100 * tabla.dificil.alto).toFixed(2)}]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLA 2: parejas. Aquí se mide la coordinación, que en individual no existe.
// La unidad vuelve a ser la RONDA porque la señal de equipo ya es enorme.
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n--- Parejas 2v2 contra dos 'normal' — rondas (${4 * N_PAREJAS} por nivel) ---`);
const parejas = {};
for (const nivel of ['facil', 'normal', 'dificil', 'maestro']) {
  parejas[nivel] = medir(nivel, 'normal', N_PAREJAS, { parejas: true, unidad: jugarRonda });
  fila(parejas[nivel]);
}
ok(Math.abs(parejas.normal.p - 0.5) < 0.02,
  `Control de parejas: 'normal' contra 'normal' sale del 50 % (${(100 * parejas.normal.p).toFixed(2)} %)`);
// Con N_PAREJAS=60 el intervalo mide ~13 puntos de ancho, asi que exigirle que
// entero pase del 50 % es exigirle a la muestra mas de lo que da: con la familia
// 777777 sale [44,51 - 57,16] y se ponia ROJO pese a ganar el 50,8 %. A este
// tamano se exige el punto con margen; el intervalo, en --largo.
ok(parejas.dificil.p > 0.53,
  `En parejas 'dificil' gana a la mesa: ${(100 * parejas.dificil.p).toFixed(2)} % ` +
  `([${(100 * parejas.dificil.bajo).toFixed(2)}, ${(100 * parejas.dificil.alto).toFixed(2)}], mínimo 53 %)`);
if (LARGO) {
  ok(parejas.dificil.bajo > 0.5,
    `En parejas el IC95 de 'dificil' entero por encima del 50 % ` +
    `([${(100 * parejas.dificil.bajo).toFixed(2)}, ${(100 * parejas.dificil.alto).toFixed(2)}])`);
}
ok(parejas.maestro.p > parejas.dificil.p,
  `En parejas 'maestro' (${(100 * parejas.maestro.p).toFixed(2)} %) sigue por encima de 'dificil' ` +
  `(${(100 * parejas.dificil.p).toFixed(2)} %)`);

// ─────────────────────────────────────────────────────────────────────────────
// MODO LARGO: las tablas finas. La de RONDA suelta es la que enseña de verdad
// cuánto pesa el reparto en una mesa de cuatro: la misma escalera, aplastada.
// ─────────────────────────────────────────────────────────────────────────────
if (LARGO) {
  console.log(`\n--- Cada nivel contra 3 'normal' — RONDA suelta (${4 * N} rondas por nivel) ---`);
  const rondas = {};
  for (const nivel of ['facil', 'normal', 'dificil', 'maestro']) {
    rondas[nivel] = medir(nivel, 'normal', N, { unidad: jugarRonda });
    fila(rondas[nivel]);
  }
  ok(rondas.facil.p < rondas.normal.p && rondas.normal.p < rondas.dificil.p && rondas.dificil.p < rondas.maestro.p,
    'La escalera también se sostiene en la ronda suelta, aunque comprimida');
  ok(rondas.dificil.bajo > BASE && rondas.maestro.bajo > rondas.dificil.alto,
    'En ronda suelta los intervalos de normal/difícil/maestro tampoco se solapan');

  // Duelo directo con el escalón de abajo. Aquí la exigencia baja al valor
  // medido y no al intervalo entero a propósito: la ventaja de 'maestro' sobre
  // 'dificil' es real pero PEQUEÑA (los dos comparten heurística; lo que añade
  // maestro es el muestreo), y su IC95 roza el 25 %. Decirlo es más útil que
  // subir N hasta que el número quede bonito.
  console.log('\n--- Cada nivel contra tres del nivel inmediatamente inferior — partidas ---');
  for (const [arriba, abajo] of [['normal', 'facil'], ['dificil', 'normal'], ['maestro', 'dificil']]) {
    const r = medir(arriba, abajo, Math.round(N / 2));
    fila({ ...r, nivel: `${arriba}/${abajo}` });
    ok(r.p > BASE,
      `'${arriba}' contra tres '${abajo}' pasa del 25 % (${(100 * r.p).toFixed(2)} %` +
      `${r.bajo > BASE ? ', IC95 entero por encima' : `, IC95 rozando el suelo: ${(100 * r.bajo).toFixed(2)} %`})`);
  }

  console.log("\n--- 1 contra 1 contra 'normal' — partidas ---");
  for (const nivel of ['facil', 'dificil', 'maestro']) {
    fila(medir(nivel, 'normal', Math.round(N / 2), { nJug: 2 }));
  }
}

console.log(`\n=== ${passed} COMPROBACIONES DE FUERZA PASARON ===`);
