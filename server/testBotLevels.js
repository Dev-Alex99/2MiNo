// NIVELES DE BOT: comportamiento propio y COMPROBABLE.
//
// Regla que gobierna todo el archivo: un test de nivel no vale si no compara la
// salida de DOS niveles sobre la MISMA posición y exige que DIFIERAN. El test
// que había antes (testBots.js) montaba dos ramas y pedía la misma respuesta a
// las dos, así que seguía en verde con la lógica de bloqueo comentada; por ese
// agujero sobrevivió veinte suites el hecho de que 'dificil' fuera un alias de
// 'normal' (3790 de 3790 jugadas idénticas).
//
// Además está el TEST DE HONESTIDAD (bloque A): se permutan las manos rivales y
// el pozo dejando intactos handCount y boneyardCount, y se exige que ni la
// observación ni la jugada cambien. Si cambian una sola vez, el bot está
// leyendo información oculta y el paquete entero no vale.

const assert = require('assert');
const DominoGame = require('./gameLogic');
const { chooseMove, choosePower, chooseFreezeEnd, ritmoDePensarMs, P } = require('./botLogic');
const { buildObservation, extremosTras } = require('./botObservation');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

console.log('=== PRUEBAS DE NIVELES DE BOT ===');

// Mesa de laboratorio: ids estables (p1..pN), manos puestas a mano y estado
// 'playing'. Es el mismo patrón de setup() que usan testBots.js y testTeams.js.
function mesa({ manos, board = [], boneyard = [], turn = 0, teams = false, passedOn = {}, maxPip = 6, powers = false }) {
  const g = new DominoGame('LAB', 500, {
    powersEnabled: powers, maxPip, drawEnabled: true, teamsEnabled: teams, seed: 1
  });
  for (let i = 0; i < manos.length; i++) g.addBot(`Bot${i + 1}`, 'normal');
  g.startNewGame();
  g.players.forEach((p, i) => {
    p.id = `p${i + 1}`;
    p.hand = manos[i].map(t => [...t]);
  });
  g.board = board.map(t => [...t]);
  g.boneyard = boneyard.map(t => [...t]);
  g.currentPlayerIndex = turn;
  g.status = 'playing';
  g.playerPassedOn = passedOn;
  g.moveLog = [];
  return g;
}

// Jugada elegida por un nivel, en forma comparable.
function elige(g, nivel, playerId) {
  const jugador = g.players.find(p => p.id === (playerId || g.players[g.currentPlayerIndex].id));
  const previo = jugador.difficulty;
  jugador.difficulty = nivel;
  const mv = chooseMove(g, jugador.id);
  jugador.difficulty = previo;
  return mv ? `${mv.tileIndex}:${mv.side}` : 'ninguna';
}

// Recorre partidas sembradas llamando a `cb` en cada posición. Las posiciones
// las genera el motor real, no un generador de tableros inventados.
function recorrerPartidas(cb, { semillas, nJug, maxPip = 6, nivelMesa = 'normal' }) {
  for (let s = 1; s <= semillas; s++) {
    const g = new DominoGame('REC', 500, { powersEnabled: false, maxPip, drawEnabled: true, seed: 50000 + s });
    for (let i = 0; i < nJug; i++) g.addBot(`B${i}`, nivelMesa);
    g.startNewGame();
    let guarda = 0;
    while (g.status === 'playing' && guarda++ < 300) {
      const actual = g.players[g.currentPlayerIndex];
      cb(g, actual);
      const mv = chooseMove(g, actual.id);
      if (mv) {
        const r = g.playTile(actual.id, mv.tileIndex, mv.side);
        if (!r.success) g.forceTurn();
      } else {
        g.forceTurn();
      }
    }
  }
}

function azar(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cambia de sitio TODO lo que el bot no puede ver (manos rivales y pozo) sin
// tocar ni un solo dato público: cada rival conserva su número de fichas y el
// pozo su tamaño. Para un bot honesto esta partida es indistinguible.
function permutarLoOculto(g, botId, rnd) {
  const bolsa = [];
  const tamanos = [];
  g.players.forEach(p => {
    if (p.id === botId) return;
    tamanos.push([p, p.hand.length]);
    p.hand.forEach(t => bolsa.push([t[0], t[1]]));
  });
  const pozo = g.boneyard.length;
  g.boneyard.forEach(t => bolsa.push([t[0], t[1]]));

  for (let i = bolsa.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [bolsa[i], bolsa[j]] = [bolsa[j], bolsa[i]];
  }

  let k = 0;
  tamanos.forEach(([p, n]) => { p.hand = bolsa.slice(k, k + n); k += n; });
  g.boneyard = bolsa.slice(k, k + pozo);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. LA FRONTERA DE LA TRAMPA
// ─────────────────────────────────────────────────────────────────────────────
{
  const rnd = azar(4242);
  let posiciones = 0;
  let observacionesDistintas = 0;
  const divergencias = { facil: 0, normal: 0, dificil: 0, maestro: 0 };

  recorrerPartidas((g, actual) => {
    if (g.board.length === 0) return;
    posiciones++;

    const antes = JSON.stringify(buildObservation(g, actual.id));
    const jugadaAntes = {};
    for (const nivel of Object.keys(divergencias)) jugadaAntes[nivel] = elige(g, nivel, actual.id);

    permutarLoOculto(g, actual.id, rnd);

    if (JSON.stringify(buildObservation(g, actual.id)) !== antes) observacionesDistintas++;
    for (const nivel of Object.keys(divergencias)) {
      if (elige(g, nivel, actual.id) !== jugadaAntes[nivel]) divergencias[nivel]++;
    }
  }, { semillas: 25, nJug: 4 });

  ok(posiciones > 300, `Honestidad: se examinaron ${posiciones} posiciones reales de partida`);
  ok(observacionesDistintas === 0,
    'La observación pública NO cambia al permutar las manos rivales y el pozo (0 diferencias)');
  const total = Object.values(divergencias).reduce((a, b) => a + b, 0);
  ok(total === 0,
    `Ningún nivel cambia de jugada al permutar lo oculto: ${JSON.stringify(divergencias)}`);
}

{
  // La observación no lleva manos ajenas ni el contenido del pozo, solo cuentas.
  const g = mesa({ manos: [[[6, 6], [5, 4]], [[1, 1], [2, 2]]], board: [[2, 3], [3, 5]], boneyard: [[0, 0]] });
  const obs = buildObservation(g, 'p1');
  const texto = JSON.stringify(obs);
  ok(!('boneyard' in obs) && !('players' in obs) && obs.handCounts.p2 === 2,
    'La observación trae handCounts y boneyardCount, nunca las manos ni el pozo');
  ok(obs.boneyardCount === 1 && !texto.includes('"hand"'),
    'No hay ninguna clave `hand` ajena en la observación');
  ok(Object.isFrozen(obs) && Object.isFrozen(obs.miMano),
    'La observación está congelada: una heurística no puede reescribirla a mitad de decisión');
}

// ─────────────────────────────────────────────────────────────────────────────
// B. La simulación usa la MISMA convención de volteo que el motor
// ─────────────────────────────────────────────────────────────────────────────
{
  let comprobados = 0;
  let discrepancias = 0;
  recorrerPartidas((g, actual) => {
    if (g.board.length === 0) return;
    const izq = g.getLeftEnd();
    const der = g.getRightEnd();
    for (const mv of g.getValidMoves(actual.id)) {
      const real = g.resultingEnd(actual.id, mv);
      const tile = actual.hand[mv.tileIndex];
      const tras = extremosTras(izq, der, tile, mv.side, !!g.activeEffects.wildcardActive);
      const mio = mv.side === 'left' ? tras.izq : tras.der;
      comprobados++;
      if (mio !== real) discrepancias++;
    }
  }, { semillas: 12, nJug: 4 });
  ok(comprobados > 500 && discrepancias === 0,
    `extremosTras coincide con game.resultingEnd en ${comprobados} jugadas (0 discrepancias)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// C. LAS CINCO CAPACIDADES DE 'DIFICIL'. Cada una: dificil lo hace, normal NO.
// ─────────────────────────────────────────────────────────────────────────────

// (1) DEDUCCIÓN POR PASES: bloquear vale más que soltar la ficha cara.
{
  // Extremos 2 y 5. [5,6] son 11 puntos y [5,0] cinco; pero el rival ya pasó
  // sobre el 0, así que dejárselo lo deja otra vez sin jugada.
  const g = mesa({
    manos: [[[5, 0], [5, 6], [0, 0]], [[1, 1]]],
    board: [[2, 3], [3, 5]], passedOn: { p2: [0] }
  });
  ok(elige(g, 'normal') === '1:right', 'Pases: NORMAL suelta la ficha cara y abre el 6');
  ok(elige(g, 'dificil') === '0:right', 'Pases: DIFÍCIL deja expuesto el número sobre el que el rival pasó');
}

// (2) CONTEO DEL MURO POR NÚMERO sobre las fichas no vistas.
{
  // Todos los cincos vivos están en mi mano o en el tablero: dejar la mesa en
  // 5/5 es un muro que nadie puede saltar. NORMAL solo sabe contar sus puntos.
  const g = mesa({
    manos: [
      [[2, 5], [2, 6], [0, 5], [1, 5], [4, 5], [5, 6], [0, 0]],
      [[1, 1], [1, 2], [1, 3]]
    ],
    board: [[5, 5], [5, 3], [3, 2]]
  });
  ok(elige(g, 'normal') === '5:left', 'Muro: NORMAL abre el 6, del que quedan copias vivas');
  ok(elige(g, 'dificil') === '0:right', 'Muro: DIFÍCIL cierra en un número sin copias vivas fuera de su mano');
}

// (3) GESTIÓN DE LA MANO: no quedarse sin salida.
{
  // Extremos 2 y 5. [2,6] son 8 puntos, pero deja la mesa en 6/5 y ninguna de
  // mis dos fichas restantes contesta a nada.
  const g = mesa({
    manos: [[[2, 6], [2, 1], [1, 3]], [[5, 5], [5, 0]]],
    board: [[2, 5]]
  });
  ok(elige(g, 'normal') === '0:left', 'Sin salida: NORMAL suelta la cara y se deja la mano muerta');
  ok(elige(g, 'dificil') === '1:left', 'Sin salida: DIFÍCIL conserva respuesta a la mesa que deja');
}

// (4) CAMBIO DE OBJETIVO CUANDO EL POZO SE SECA.
{
  // La MISMA posición dos veces: solo cambia si queda pozo. Las dos jugadas
  // dejan la mesa igual (5/4), así que lo único que puede moverlas es que el
  // final ya empezó: con el pozo seco, cerrarle el paso al rival pesa más que
  // soltar dos puntos de más.
  const tablero = [[5, 4], [4, 1], [1, 6], [6, 4], [4, 2], [2, 7], [7, 4], [4, 3], [3, 8], [8, 4]];
  const conPozo = mesa({
    manos: [[[5, 5], [4, 4]], [[9, 9], [0, 9]]], board: tablero,
    boneyard: [[0, 1], [0, 2], [0, 3]], maxPip: 9
  });
  const sinPozo = mesa({
    manos: [[[5, 5], [4, 4]], [[9, 9], [0, 9]]], board: tablero, boneyard: [], maxPip: 9
  });
  ok(elige(conPozo, 'normal') === elige(sinPozo, 'normal'),
    'Final: NORMAL juega igual con pozo y sin pozo (no sabe que el final empezó)');
  ok(elige(conPozo, 'dificil') !== elige(sinPozo, 'dificil'),
    'Final: DIFÍCIL cambia de jugada cuando el pozo se seca');
  ok(elige(sinPozo, 'dificil') === '1:right',
    'Final: con el pozo seco, DIFÍCIL expone el número que su objetivo falla con más probabilidad');
}

// (5) PAREJAS: pasarle la mano al compañero, no ahogarlo.
{
  // Beto (asiento 1) es pareja de Dani (asiento 3), que ya pasó sobre el 4.
  const g = mesa({
    manos: [[[0, 0]], [[5, 4], [5, 0]], [[0, 0]], [[0, 0]]],
    board: [[2, 3], [3, 5]], turn: 1, teams: true, passedOn: { p4: [4] }
  });
  ok(elige(g, 'normal') === '0:right', 'Parejas: NORMAL no distingue compañero de rival y suelta puntos');
  ok(elige(g, 'dificil') === '1:right', 'Parejas: DIFÍCIL no deja expuesto el número que falló su compañero');
}

// ─────────────────────────────────────────────────────────────────────────────
// D. 'MAESTRO' > 'DIFÍCIL': cierre deliberado y final exacto
// ─────────────────────────────────────────────────────────────────────────────
{
  // Final real salido de una partida sembrada (semilla 90265). Quedan 3 fichas
  // sin ver, así que 'maestro' entra en la búsqueda exacta: resuelve el final
  // entero y encuentra la única jugada que gana la ronda. La heurística de
  // 'dificil' suelta el doble 0 y la pierde.
  const tablero = [
    [0, 4], [4, 4], [4, 2], [2, 0], [0, 6], [6, 1], [1, 3], [3, 4], [4, 1], [1, 1], [1, 5],
    [5, 6], [6, 6], [6, 4], [4, 5], [5, 3], [3, 0], [0, 5], [5, 5], [5, 2], [2, 6], [6, 3]
  ];
  const manos = [[[0, 1], [3, 3], [0, 0]], [[1, 2], [2, 2], [2, 3]]];
  const g = mesa({ manos, board: tablero, boneyard: [] });
  const obs = buildObservation(g, 'p1');
  ok(obs.unseenCount === 3, `Final exacto: solo quedan ${obs.unseenCount} fichas sin ver`);

  const jugadaDificil = elige(g, 'dificil');
  const jugadaMaestro = elige(g, 'maestro');
  ok(jugadaDificil !== jugadaMaestro,
    `Cierre: MAESTRO (${jugadaMaestro}) no juega lo mismo que DIFÍCIL (${jugadaDificil})`);

  // Y no es una diferencia cosmética: se termina la ronda con cada jugada.
  const terminar = (jugada, nivel) => {
    const h = mesa({ manos, board: tablero, boneyard: [] });
    h.players[0].difficulty = nivel;
    h.players[1].difficulty = 'normal';
    const [idx, lado] = jugada.split(':');
    h.playTile('p1', Number(idx), lado);
    let guarda = 0;
    while (h.status === 'playing' && guarda++ < 60) {
      const actual = h.players[h.currentPlayerIndex];
      const mv = chooseMove(h, actual.id);
      if (mv) { const r = h.playTile(actual.id, mv.tileIndex, mv.side); if (!r.success) h.forceTurn(); } else h.forceTurn();
    }
    return h.roundWinner;
  };
  ok(terminar(jugadaMaestro, 'maestro') === 'p1', 'Cierre: la jugada de MAESTRO gana la ronda');
  ok(terminar(jugadaDificil, 'dificil') !== 'p1', 'Cierre: la de DIFÍCIL la pierde');
}

// ─────────────────────────────────────────────────────────────────────────────
// E. 'FÁCIL' está invertido a propósito (no es azar: es criterio malo)
// ─────────────────────────────────────────────────────────────────────────────
{
  const g = mesa({ manos: [[[5, 6], [5, 0]], [[1, 1]]], board: [[2, 3], [3, 5]] });
  ok(elige(g, 'facil') === '1:right' && elige(g, 'normal') === '0:right',
    'Fácil: suelta la ficha barata y se guarda la cargada; normal hace lo contrario');

  const h = mesa({ manos: [[[5, 5], [5, 1]], [[1, 1]]], board: [[2, 3], [3, 5]] });
  ok(elige(h, 'facil') === '1:right' && elige(h, 'normal') === '0:right',
    'Fácil: se guarda el doble «por si acaso»; normal lo coloca cuanto antes');

  // Sigue siendo legal SIEMPRE: torpe no es tramposo.
  let ilegales = 0;
  recorrerPartidas((g2, actual) => {
    const previo = actual.difficulty;
    actual.difficulty = 'facil';
    const mv = chooseMove(g2, actual.id);
    actual.difficulty = previo;
    if (mv && !g2.getValidMoves(actual.id).some(l => l.tileIndex === mv.tileIndex && l.side === mv.side)) ilegales++;
  }, { semillas: 10, nJug: 4 });
  ok(ilegales === 0, 'Fácil: ninguna jugada ilegal en un recorrido completo de partidas');
}

// ─────────────────────────────────────────────────────────────────────────────
// F. Ningún nivel es alias de otro (lo contrario del defecto de partida)
// ─────────────────────────────────────────────────────────────────────────────
{
  const cuenta = { total: 0, dificilVsNormal: 0, maestroVsDificil: 0, facilVsNormal: 0 };
  recorrerPartidas((g, actual) => {
    if (g.getValidMoves(actual.id).length < 2) return;
    cuenta.total++;
    const n = elige(g, 'normal', actual.id);
    if (elige(g, 'dificil', actual.id) !== n) cuenta.dificilVsNormal++;
    if (elige(g, 'facil', actual.id) !== n) cuenta.facilVsNormal++;
    if (elige(g, 'maestro', actual.id) !== elige(g, 'dificil', actual.id)) cuenta.maestroVsDificil++;
  }, { semillas: 12, nJug: 4 });

  const pct = n => (100 * n / cuenta.total).toFixed(1);
  ok(cuenta.dificilVsNormal / cuenta.total > 0.10,
    `'dificil' difiere de 'normal' en el ${pct(cuenta.dificilVsNormal)} % de las posiciones con elección (antes: 0 %)`);
  ok(cuenta.maestroVsDificil / cuenta.total > 0.05,
    `'maestro' difiere de 'dificil' en el ${pct(cuenta.maestroVsDificil)} %`);
  ok(cuenta.facilVsNormal / cuenta.total > 0.30,
    `'facil' difiere de 'normal' en el ${pct(cuenta.facilVsNormal)} %`);
}

// ─────────────────────────────────────────────────────────────────────────────
// G. Determinismo: misma posición, misma jugada (sin esto no hay medición)
// ─────────────────────────────────────────────────────────────────────────────
{
  let inestables = 0;
  recorrerPartidas((g, actual) => {
    for (const nivel of ['facil', 'normal', 'dificil', 'maestro']) {
      if (elige(g, nivel, actual.id) !== elige(g, nivel, actual.id)) inestables++;
    }
  }, { semillas: 8, nJug: 4 });
  ok(inestables === 0, 'Los cuatro niveles son deterministas: dos llamadas idénticas dan la misma jugada');
}

// ─────────────────────────────────────────────────────────────────────────────
// H. CONGELAR EXTREMO: el bot consigue usarla y la carta sale de su mano
// ─────────────────────────────────────────────────────────────────────────────
{
  const g = mesa({
    manos: [[[5, 0], [5, 6]], [[1, 1], [2, 2]]],
    board: [[2, 3], [3, 5]], powers: true
  });
  g.players[0].difficulty = 'maestro';

  const extremo = chooseFreezeEnd(g, 'p1');
  ok(extremo === 'left' || extremo === 'right',
    `El cerebro elige un extremo concreto para Congelar (${extremo}), no null`);

  g.players[0].powers = [{ id: 'freeze', name: 'Congelar Extremo', type: 'attack' }];
  const usado = g.usePowerCard('p1', 'freeze', extremo, null);
  ok(usado.success, 'usePowerCard acepta Congelar con el extremo que eligió el bot');
  ok(g.players[0].powers.length === 0, 'La carta SALE de la mano del bot (antes se quedaba pegada para siempre)');
  ok(g.activeEffects.frozenEnd === extremo, `El extremo queda congelado (${g.activeEffects.frozenEnd})`);

  // Y por la vía real: playBotTurn, que es donde estaba el fallo.
  let congelo = false;
  for (let intento = 0; intento < 60 && !congelo; intento++) {
    const h = mesa({
      manos: [[[5, 0], [5, 6]], [[1, 1], [2, 2]]],
      board: [[2, 3], [3, 5]], powers: true
    });
    h.players[0].difficulty = 'maestro';
    h.players[0].powers = [{ id: 'freeze', name: 'Congelar Extremo', type: 'attack' }];
    h.playBotTurn('p1');
    if (h.activeEffects.frozenEnd && h.players[0].powers.length === 0) congelo = true;
  }
  ok(congelo, 'playBotTurn llega a congelar de verdad un extremo (antes: nunca, ni una vez)');

  // Sin tablero no se elige Congelar: congelar la nada gastaría la tirada.
  const vacio = mesa({ manos: [[[5, 0]], [[1, 1]]], board: [], powers: true });
  vacio.players[0].difficulty = 'maestro';
  vacio.players[0].powers = [{ id: 'freeze', name: 'Congelar Extremo', type: 'attack' }];
  ok(choosePower(vacio, 'p1', () => 0) === null, 'Con el tablero vacío el bot no elige Congelar');
  ok(chooseFreezeEnd(vacio, 'p1') === null, 'chooseFreezeEnd devuelve null si no hay extremos');
}

// ─────────────────────────────────────────────────────────────────────────────
// I. PRESUPUESTO DE CPU. playBotTurn corre dentro de un setTimeout y bloquea el
//    event loop de TODAS las salas: el peor caso importa más que la media.
// ─────────────────────────────────────────────────────────────────────────────
{
  const medidas = { facil: [], normal: [], dificil: [], maestro: [] };
  for (const [nJug, maxPip] of [[4, 6], [4, 9], [2, 6]]) {
    recorrerPartidas((g, actual) => {
      for (const nivel of Object.keys(medidas)) {
        const previo = actual.difficulty;
        actual.difficulty = nivel;
        const t0 = process.hrtime.bigint();
        chooseMove(g, actual.id);
        medidas[nivel].push(Number(process.hrtime.bigint() - t0) / 1e6);
        actual.difficulty = previo;
      }
    }, { semillas: 12, nJug, maxPip });
  }
  for (const nivel of Object.keys(medidas)) {
    const m = medidas[nivel];
    const media = m.reduce((a, b) => a + b, 0) / m.length;
    const peor = Math.max(...m);
    console.log(`  · ${nivel.padEnd(8)} ${m.length} jugadas — media ${media.toFixed(3)} ms, peor ${peor.toFixed(2)} ms`);
    ok(peor < 100, `${nivel}: ninguna jugada pasa del techo duro de 100 ms (peor: ${peor.toFixed(2)} ms)`);
    ok(media < 5, `${nivel}: media muy por debajo del objetivo de 30 ms (${media.toFixed(3)} ms)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// J. RITMO: el jugador nota el nivel antes de ver ninguna estadística
// ─────────────────────────────────────────────────────────────────────────────
{
  const g = mesa({ manos: [[[5, 0], [5, 6]], [[1, 1], [2, 2]]], board: [[2, 3], [3, 5]], boneyard: [[0, 0]] });
  const tramo = nivel => {
    const bot = { difficulty: nivel };
    return [ritmoDePensarMs(g, bot, () => 0), ritmoDePensarMs(g, bot, () => 0.999)];
  };
  const [fMin, fMax] = tramo('facil');
  const [nMin, nMax] = tramo('normal');
  const [dMin, dMax] = tramo('dificil');
  const [mMin, mMax] = tramo('maestro');
  ok(fMin < nMin && nMin < dMin && dMin < mMin && fMax < nMax && nMax < dMax && dMax < mMax,
    `Ritmo escalonado por nivel: fácil ${fMin}-${fMax}, normal ${nMin}-${nMax}, ` +
    `difícil ${dMin}-${dMax}, maestro ${mMin}-${mMax} ms`);

  // Jugada crítica: pozo seco y alguien a punto de cerrar.
  const critico = mesa({ manos: [[[5, 0], [5, 6]], [[1, 1]]], board: [[2, 3], [3, 5]], boneyard: [] });
  const normalMs = ritmoDePensarMs(g, { difficulty: 'maestro' }, () => 0);
  const criticoMs = ritmoDePensarMs(critico, { difficulty: 'maestro' }, () => 0);
  ok(criticoMs - normalMs === 900, 'En la jugada crítica el bot se para 900 ms más');

  // Un juego que no es dominó (sin pozo ni manos de fichas) no revienta.
  ok(ritmoDePensarMs({}, { difficulty: undefined }, () => 0.5) > 0,
    'ritmoDePensarMs tolera un juego sin pozo ni niveles (Uno usa el mismo orquestador)');
}

// -----------------------------------------------------------------------------
// K. LAS CAPACIDADES INFLUYEN DE VERDAD: mutacion de pesos sobre un corpus
//
// Por que existe este bloque: una auditoria adversarial puso bloqueoRival,
// abrirRival y sinSalida a cero y esta suite siguio en 47/47. Las posiciones del
// bloque C estan construidas a mano y en ellas otro peso llegaba por su cuenta a
// la misma jugada, asi que tres de las cinco capacidades no tenian NINGUNA
// cobertura: se podian borrar y el arbol seguia verde.
//
// Aqui se ataca por el otro lado. En vez de una posicion elegida, se miden
// cientos generadas por el motor y se cuenta cuantas decisiones CAMBIAN al
// anular el peso. Un peso que no cambia ninguna decision no esta haciendo nada,
// y eso es exactamente lo que este bloque no deja pasar.
// -----------------------------------------------------------------------------
{
  // Corpus de posiciones REALES con mas de una jugada legal, reconstruidas como
  // mesas de laboratorio independientes: recorrerPartidas reutiliza el mismo
  // objeto de juego y lo va mutando, asi que guardar la referencia daria
  // cientos de copias del estado final.
  const corpus = [];
  recorrerPartidas((g, actual) => {
    if (corpus.length >= 900) return;
    if (g.getValidMoves(actual.id).length < 2) return;
    const orden = g.players.map(p => p.id);
    const passedOn = {};
    orden.forEach((id, i) => {
      const v = (g.playerPassedOn || {})[id];
      if (v && v.length) passedOn[`p${i + 1}`] = [...v];
    });
    corpus.push(mesa({
      manos: g.players.map(p => p.hand.map(t => [...t])),
      board: g.board.map(t => [...t]),
      boneyard: g.boneyard.map(t => [...t]),
      turn: orden.indexOf(actual.id),
      passedOn
    }));
  }, { semillas: 40, nJug: 4 });

  // Ejecuta `fn` con esos pesos a cero y los restaura pase lo que pase.
  const sinPesos = (claves, fn) => {
    const previos = {};
    claves.forEach(k => { previos[k] = P[k]; P[k] = 0; });
    try { return fn(); } finally { Object.assign(P, previos); }
  };

  // Cada capacidad se mide donde PUEDE aplicar. La deduccion por pases no puede
  // cambiar nada en una posicion en la que nadie ha pasado todavia: medirla ahi
  // solo diluye la senal con ruido.
  const conPases = g => Object.values(g.playerPassedOn || {}).some(v => v && v.length);
  const decidir = sub => sub.map(g => elige(g, 'dificil'));
  const divergencias = (claves, sub) => {
    const base = decidir(sub);
    const mutado = sinPesos(claves, () => decidir(sub));
    return base.reduce((n, v, i) => n + (v === mutado[i] ? 0 : 1), 0);
  };

  const referencia = decidir(corpus);
  ok(corpus.length >= 500, `Corpus de mutacion: ${corpus.length} posiciones con eleccion real`);

  const conPasesSub = corpus.filter(conPases);
  ok(conPasesSub.length >= 100,
    `De ellas, ${conPasesSub.length} con algun pase registrado (donde la deduccion puede aplicar)`);

  // Los minimos son la mitad de lo medido, redondeando a la baja: dejan sitio a
  // un reajuste de pesos sin volverse fragiles, y siguen cayendo a rojo si la
  // capacidad desaparece, porque entonces el contador es exactamente 0.
  const CAPACIDADES = [
    ['Deduccion por pases', ['bloqueoRival', 'bloqueoSiguiente', 'mantenerBloqueo'], () => conPasesSub, 5],
    ['Conteo del muro', ['abrirRival', 'abrirSiguiente'], () => corpus, 40],
    ['Gestion de la mano', ['sinSalida', 'reserva', 'respuesta'], () => corpus, 50]
  ];
  for (const [nombre, claves, sub, minimo] of CAPACIDADES) {
    const conjunto = sub();
    const n = divergencias(claves, conjunto);
    ok(n >= minimo,
      `${nombre}: anular ${claves.join('+')} cambia ${n} de ${conjunto.length} decisiones ` +
      `(minimo ${minimo}); si alguien borra la capacidad, esto cae a 0`);
  }

  // Y los pesos se restauran: si este bloque dejara la tabla tocada, todo lo que
  // corriera despues mediria otro bot.
  const mismasDecisiones = decidir(corpus).every((v, i) => v === referencia[i]);
  ok(mismasDecisiones, 'La tabla de pesos queda restaurada tras las mutaciones');
}

console.log(`\n=== ${passed} PRUEBAS DE NIVELES DE BOT PASARON ===`);
