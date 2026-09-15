// IA de los bots. Funciones puras: reciben la partida y devuelven qué hacer,
// sin tocar sockets ni temporizadores.
//
// EL CEREBRO NO VE LA PARTIDA. chooseMove es lo único que recibe el objeto
// DominoGame, y lo primero que hace es convertirlo en una observación pública
// (botObservation.js). A partir de ahí ninguna función de este archivo tiene
// forma de mirar la mano de un rival ni el contenido del pozo: no las recibe.
// Ver la cabecera de botObservation.js para por qué eso es un tipo de dato y
// no una promesa.
//
// Los cuatro niveles y en qué se diferencian de verdad:
//   facil   heurística INVERTIDA a propósito: se guarda los dobles y las
//           cargadas y suelta primero lo barato. No mira los pases.
//   normal  la heurística de una jugada, depurada: puntos, dobles y reserva
//           del número que deja expuesto. NO deduce por pases ni coordina con
//           el compañero: ese es el suelo desde el que crece 'difícil'.
//   dificil normal + cinco capacidades nuevas, todas con información pública:
//           deducción por pases sostenida, conteo del muro por número sobre
//           las fichas no vistas, gestión de la mano para no quedarse sin
//           salida, cambio de objetivo con el pozo seco y parejas de verdad.
//   maestro dificil + muestreo de repartos (cierre deliberado: cierra cuando
//           las cuentas le salen) + final exacto cuando quedan pocas fichas
//           sin ver, con tope duro de tiempo.
//
// EL BUCLE ES SÍNCRONO. playBotTurn corre dentro de un setTimeout del proceso
// (roomManager.scheduleBotTurn) y bloquea el event loop de TODAS las salas
// mientras piensa. Por eso 'maestro' lleva presupuesto de tiempo y de nodos, y
// degrada a la heurística de 'dificil' en cuanto lo agota: nunca un bucle sin
// cota. Coste medido en testBotLevels.js.

const { buildObservation, extremosTras, encaja, combinaciones } = require('./botObservation');

const BOT_NAMES = ['Rita', 'Chema', 'Yuri', 'Nando', 'Pilar', 'Bruno', 'Tere', 'Iván'];

const SAFE_BOT_POWERS = ['shield', 'double_shot', 'skip', 'freeze', 'wildcard'];

// Pesos de 'dificil'. Están en la misma escala que los puntos de una ficha
// (0-12) para que se puedan leer: 18 de bloqueo es "vale más que soltar la
// ficha más cara del mazo".
const P = {
  puntos: 1,            // soltar la ficha cara (lo único que mira 'normal')
  doble: 6,             // el doble se coloca mal más tarde: fuera pronto
  dobleFuerte: 28,      // ...y 'dificil' descubrió midiendo que MUCHO más
  reserva: 5,           // por copia propia del número que dejo expuesto (máx 2)
  respuesta: 3,         // por respuesta propia a los DOS extremos (máx 4)
  sinSalida: 22,        // tras la jugada no contesto a ninguno de los dos
  abrirRival: 40,       // prob. media de que un rival pueda contestar
  abrirSiguiente: 30,   // ...del que juega justo detrás, que es quien decide
  abrirCompanero: 20,   // en parejas, que el compañero SÍ pueda contestar suma
  bloqueoRival: 18,     // el rival ya pasó sobre este número: certeza, no cálculo
  bloqueoSiguiente: 9,  // ...y además juega justo detrás de mí
  mantenerBloqueo: 10,  // tapar un extremo que era un fallo vivo lo regala
  ahogarCompanero: 16,  // el compañero pasó sobre este número
  finalFallo: 14,       // final: exponer lo que el objetivo probablemente falla
  finalPuntos: 0.6      // final: soltar puntos deja de ser la prioridad
};

// Presupuesto de 'maestro'. objetivoMs es el trabajo que se pretende hacer;
// topeMs es el techo por jugada del que NUNCA se pasa (el event loop es de
// todas las salas). Medido en testBotLevels.js sobre el peor caso.
const MAESTRO = {
  muestras: 64,        // repartos muestreados por decisión
  candidatas: 5,       // jugadas que llegan al muestreo (poda por heurística)
  objetivoMs: 30,
  topeMs: 100,
  plies: 80,           // cota de la simulación rápida (una ronda no llega)
  exactoManoMax: 3,    // final exacto: fichas mías
  exactoUnseenMax: 6,  // final exacto: fichas sin ver
  exactoRepartos: 24,
  exactoNodos: 30000,
  pesoMuestreo: 3      // cuánto pesa el muestreo frente a la heurística
};

function pickBotName(takenNames) {
  const taken = new Set(takenNames.map(n => n.toLowerCase()));
  const free = BOT_NAMES.filter(n => !taken.has(n.toLowerCase()));
  const pool = free.length ? free : BOT_NAMES;
  const base = pool[Math.floor(Math.random() * pool.length)];
  return free.length ? base : `${base} ${Math.floor(Math.random() * 90) + 10}`;
}

// Azar sembrable local (mulberry32). Es el mismo generador que DominoGame, pero
// copiado a propósito: botLogic no debe depender del motor para pensar, y son
// seis líneas. Lo usa 'maestro' para muestrear repartos de forma REPRODUCIBLE:
// dos veces la misma posición dan la misma jugada, que es lo que permite medir.
function azarDesde(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Semilla derivada SOLO de la observación: misma posición pública, mismo
// muestreo. Sin esto el torneo de fuerza no sería reproducible.
function semillaDe(obs) {
  let h = 2166136261;
  const mezcla = n => { h ^= (n + 1) & 0xff; h = Math.imul(h, 16777619); };
  obs.board.forEach(t => { mezcla(t[0]); mezcla(t[1]); });
  obs.miMano.forEach(t => { mezcla(t[0] + 8); mezcla(t[1] + 8); });
  obs.orden.forEach(id => {
    mezcla(obs.handCounts[id] + 20);
    obs.passedOn[id].forEach(v => mezcla(v + 40));
  });
  mezcla(obs.boneyardCount + 60);
  return h >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Heurísticas por nivel. Todas reciben la observación, jamás el juego.
// ─────────────────────────────────────────────────────────────────────────────

// Novato: se guarda los dobles y las cargadas "por si acaso" y suelta primero
// lo barato. No es azar —eso es impredecible, no torpe—: es un criterio malo y
// constante, el que de verdad se ve en una mesa de principiantes. Se queda con
// el [6,6] en la mano y regala 20 puntos en cada tranca.
function puntuarFacil(obs, mv) {
  const [a, b] = mv.tile;
  let s = -(a + b);
  if (a === b) s -= 12;
  return s;
}

// La heurística de una jugada: soltar puntos, colocar el doble pronto y no
// dejar expuesto un número del que no me queda ninguna copia. Es lo que juega
// 'normal', y a propósito NO deduce nada de los pases ni mira al compañero.
function puntuarNormal(obs, mv) {
  const [a, b] = mv.tile;
  let s = a + b;
  if (a === b) s += P.doble;
  if (obs.tableroVacio) return s;
  const resto = restoDeMano(obs, mv);
  if (resto.some(t => t[0] === mv.expone || t[1] === mv.expone)) s += 4;
  return s;
}

function restoDeMano(obs, mv) {
  return obs.miMano.filter((_, i) => i !== mv.tileIndex);
}

// Cuántos turnos faltan para que le llegue el turno a `id` contando desde mí.
function distanciaEnTurnos(obs, id) {
  const n = obs.orden.length;
  const i = obs.orden.indexOf(id);
  if (i === -1) return n;
  const paso = obs.efectos.reversed ? -1 : 1;
  return ((i - obs.miIndice) * paso + n) % n;
}

// Con el pozo seco los pases dejan de ser una pista y pasan a ser información
// dura, y la ronda se decide por quién cierra antes. El objetivo es el rival
// que está más cerca de quedarse sin fichas; a igualdad, el que juega antes.
function objetivoDeCierre(obs) {
  let mejor = null;
  let mejorFichas = Infinity;
  let mejorDist = Infinity;
  obs.rivals.forEach(id => {
    const fichas = obs.handCounts[id];
    const dist = distanciaEnTurnos(obs, id);
    if (fichas < mejorFichas || (fichas === mejorFichas && dist < mejorDist)) {
      mejor = id;
      mejorFichas = fichas;
      mejorDist = dist;
    }
  });
  return mejor;
}

// Probabilidad de que `id` pueda contestar a unos extremos dados. Es el CONTEO
// DEL MURO hecho bien: cuenta las copias vivas entre las fichas NO VISTAS —no
// los pips ya jugados del tablero, que es exactamente al revés— y la reparte
// con una hipergeométrica sobre las fichas que tiene. Los pases mandan sobre
// el cálculo: si ya pasó sobre los dos extremos, la probabilidad es 0 y punto.
function pContesta(obs, id, izq, der, encajanCache) {
  if (!id) return 0;
  const fallos = obs.passedOn[id] || [];
  if (fallos.includes(izq) && fallos.includes(der)) return 0;
  const m = obs.handCounts[id] || 0;
  const U = obs.unseenCount;
  const k = encajanCache;
  if (m <= 0 || U <= 0 || k <= 0) return 0;
  if (U - k < m) return 1;
  return 1 - combinaciones(U - k, m) / combinaciones(U, m);
}

// 'dificil': la heurística de una jugada MÁS las cinco capacidades que 'normal'
// no tiene. Cada bloque está numerado igual que en testBotLevels.js, donde se
// prueba que el nivel de abajo NO lo hace.
function puntuarDificil(obs, mv) {
  const [a, b] = mv.tile;
  const resto = restoDeMano(obs, mv);
  // (4a) El final empieza cuando el pozo no da más y alguien está a punto de
  // cerrar. Ahí soltar la ficha cara deja de ser la prioridad: lo que decide
  // la ronda es quién cierra. (Ojo: en doble-6 a 4 jugadores el pozo nace
  // vacío, así que "sin pozo" por sí solo no significa "final".)
  const sinPozo = obs.boneyardCount === 0;
  const minRival = obs.rivals.reduce((m, id) => Math.min(m, obs.handCounts[id]), Infinity);
  const final = sinPozo && (obs.miManoCount <= 4 || minRival <= 3);

  let s = (a + b) * (final ? P.finalPuntos : P.puntos);
  if (a === b) s += P.dobleFuerte;

  if (obs.tableroVacio) {
    // Salida: el doble más alto y, a igualdad, el palo del que más tengo, para
    // poder seguir yo mismo el extremo que abro.
    const apoyo = n => resto.filter(t => t[0] === n || t[1] === n).length;
    return s + P.reserva * Math.min(apoyo(a) + apoyo(b), 4);
  }

  const n = mv.expone;

  // (1) DEDUCCIÓN POR PASES, sostenida. No basta con dejar una vez el número
  // que el rival falló: hay que MANTENERLO en la mesa. Por eso taparlo resta.
  for (const id of obs.rivals) {
    if (obs.passedOn[id].includes(n)) {
      s += P.bloqueoRival + (id === obs.siguiente ? P.bloqueoSiguiente : 0);
    }
  }
  if (mv.tapa !== null && obs.rivals.some(id => obs.passedOn[id].includes(mv.tapa))) {
    s -= P.mantenerBloqueo;
  }

  // (2) CONTEO DEL MURO POR NÚMERO. Cuántas de las fichas que no he visto
  // encajan en la mesa que dejo: de ahí sale, con una hipergeométrica, la
  // probabilidad de que cada rival pueda contestar. Es lo contrario del
  // recuento de pips del tablero que hacía 'maestro' —que premiaba el palo ya
  // gastado, justo el que ya no bloquea a nadie—, y funciona desde la primera
  // jugada, mucho antes de que haya un solo pase que deducir.
  const encajan = obs.unseen.reduce(
    (c, t) => (encaja(t, mv.nuevoIzq, mv.nuevoDer) ? c + 1 : c), 0
  );
  let sumaRival = 0;
  for (const id of obs.rivals) {
    const p = pContesta(obs, id, mv.nuevoIzq, mv.nuevoDer, encajan);
    sumaRival += p;
    if (id === obs.siguiente) s -= P.abrirSiguiente * p;
  }
  if (obs.rivals.length) s -= P.abrirRival * (sumaRival / obs.rivals.length);
  // Y del mismo cálculo sale la reserva propia: el número que dejo expuesto
  // vale más si soy YO quien puede seguirlo.
  const mias = resto.filter(t => t[0] === n || t[1] === n).length;
  s += P.reserva * Math.min(mias, 2);

  // (5) PAREJAS. Al rival hay que cerrarle; al compañero, ABRIRLE. Pasarle la
  // mano es dejarle expuesto el número que con más probabilidad tiene, no la
  // regla binaria de «si pasó sobre él, evítalo» que era todo lo que había.
  for (const id of obs.partners) {
    if (obs.passedOn[id].includes(n)) s -= P.ahogarCompanero;
    s += P.abrirCompanero * pContesta(obs, id, mv.nuevoIzq, mv.nuevoDer, encajan);
  }

  // (3) GESTIÓN DE LA MANO. Mira los DOS extremos resultantes, no solo el que
  // creo: una jugada que me deja sin respuesta a ninguno de los dos me manda
  // al pozo o al pase en mi propio turno.
  const respuestas = resto.filter(t => encaja(t, mv.nuevoIzq, mv.nuevoDer)).length;
  if (resto.length > 0 && respuestas === 0) s -= P.sinSalida;
  else s += P.respuesta * Math.min(respuestas, 4);

  // (4b) FINAL DE RONDA: cerrarle el paso al que va ganando la carrera.
  if (final) {
    const objetivo = objetivoDeCierre(obs);
    if (objetivo) s += P.finalFallo * (1 - obs.pTiene(objetivo, n));
  }

  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulación de 'maestro'. Trabaja sobre repartos MUESTREADOS de las fichas no
// vistas: nunca sobre las manos reales, que no están en la observación.
// Ignora poderes y efectos temporales a propósito (caducan en el turno
// siguiente y modelarlos multiplicaría el coste por nada).
// ─────────────────────────────────────────────────────────────────────────────

// Reparte las no vistas entre rivales y pozo respetando handCount, boneyardCount
// y los fallos conocidos: a quien pasó sobre el 4 no se le adjudica un 4. Si no
// hay fichas compatibles suficientes se completa con lo que haya (el registro
// puede haber quedado obsoleto por un poder), nunca se devuelve un reparto corto.
function muestrearReparto(obs, rnd) {
  const pool = obs.unseen.map(t => [t[0], t[1]]);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Primero los más restringidos: si al que más falla se le reparte al final,
  // se queda sin fichas compatibles y el reparto miente más de lo necesario.
  const otros = obs.orden
    .filter(id => id !== obs.playerId)
    .sort((x, y) => obs.passedOn[y].length - obs.passedOn[x].length);

  const manos = {};
  for (const id of otros) {
    const cuantas = obs.handCounts[id];
    const fallos = obs.passedOn[id];
    const mano = [];
    for (let i = 0; i < pool.length && mano.length < cuantas; i++) {
      const t = pool[i];
      if (!t) continue;
      if (fallos.length && fallos.some(f => t[0] === f || t[1] === f)) continue;
      mano.push(t);
      pool[i] = null;
    }
    for (let i = 0; i < pool.length && mano.length < cuantas; i++) {
      if (!pool[i]) continue;
      mano.push(pool[i]);
      pool[i] = null;
    }
    manos[id] = mano;
  }
  return { manos, pozo: pool.filter(Boolean) };
}

function crearEstado(obs, reparto) {
  return {
    izq: obs.izq,
    der: obs.der,
    manos: obs.orden.map(id => (
      id === obs.playerId ? obs.miMano.map(t => [t[0], t[1]]) : reparto.manos[id].map(t => [t[0], t[1]])
    )),
    pozo: reparto.pozo.map(t => [t[0], t[1]]),
    turno: obs.miIndice,
    pases: 0,
    paso: obs.efectos.reversed ? -1 : 1
  };
}

function legalesEn(est, mano) {
  const out = [];
  if (est.izq === null) {
    for (let i = 0; i < mano.length; i++) out.push({ i, side: 'left' });
    return out;
  }
  for (let i = 0; i < mano.length; i++) {
    const t = mano[i];
    if (t[0] === est.izq || t[1] === est.izq) out.push({ i, side: 'left' });
    if (t[0] === est.der || t[1] === est.der) out.push({ i, side: 'right' });
  }
  return out;
}

function aplicarEn(est, jugada) {
  const mano = est.manos[est.turno];
  const tile = mano[jugada.i];
  const tras = extremosTras(est.izq, est.der, tile, jugada.side, false);
  est.izq = tras.izq;
  est.der = tras.der;
  mano.splice(jugada.i, 1);
}

function sumaMano(mano) {
  let s = 0;
  for (const t of mano) s += t[0] + t[1];
  return s;
}

// Valor de la ronda terminada, en puntos y desde MI asiento (o el de mi
// pareja). Positivo = los puntos que me llevo; negativo = los que me cuestan.
// Es lo que convierte "cerrar" en una decisión con cuentas y no en una manía.
function valorTerminal(obs, est, ganadorIdx) {
  const sumas = est.manos.map(sumaMano);
  let idx = ganadorIdx;
  if (idx === -1) {
    let min = Infinity;
    let empate = false;
    sumas.forEach((v, i) => {
      if (v < min) { min = v; idx = i; empate = false; } else if (v === min) empate = true;
    });
    if (empate) return 0;
  }
  const ganadorId = obs.orden[idx];
  let puntos = 0;
  sumas.forEach((v, i) => { if (i !== idx) puntos += v; });
  const esMio = ganadorId === obs.playerId
    || (obs.teamsEnabled && obs.equipos[ganadorId] === obs.miEquipo);
  return esMio ? puntos : -puntos;
}

// Política rápida para los rivales dentro de la simulación: la heurística de
// una jugada. No se les supone más cerebro del que tienen.
function elegirRapida(est, mano) {
  const jugadas = legalesEn(est, mano);
  if (jugadas.length === 0) return null;
  let mejor = jugadas[0];
  let mejorS = -Infinity;
  for (const j of jugadas) {
    const t = mano[j.i];
    let s = t[0] + t[1];
    if (t[0] === t[1]) s += P.doble;
    const tras = extremosTras(est.izq, est.der, t, j.side, false);
    const expone = j.side === 'left' ? tras.izq : tras.der;
    for (let k = 0; k < mano.length; k++) {
      if (k === j.i) continue;
      if (mano[k][0] === expone || mano[k][1] === expone) { s += 4; break; }
    }
    if (s > mejorS) { mejorS = s; mejor = j; }
  }
  return mejor;
}

// Juega la ronda hasta el final con la política rápida y devuelve el valor.
function simularRonda(obs, est) {
  const nJug = est.manos.length;
  let plies = 0;
  while (plies++ < MAESTRO.plies) {
    const mano = est.manos[est.turno];
    if (mano.length === 0) return valorTerminal(obs, est, est.turno);

    let jugada = elegirRapida(est, mano);
    while (!jugada && obs.drawEnabled && est.pozo.length > 0) {
      mano.push(est.pozo.pop());
      jugada = elegirRapida(est, mano);
    }

    if (jugada) {
      aplicarEn(est, jugada);
      est.pases = 0;
      if (est.manos[est.turno].length === 0) return valorTerminal(obs, est, est.turno);
    } else {
      est.pases++;
      if (est.pases >= nJug) return valorTerminal(obs, est, -1);
    }
    est.turno = (est.turno + est.paso + nJug) % nJug;
  }
  return valorTerminal(obs, est, -1);
}

// Búsqueda exacta del final. Con pocas fichas sin ver cada reparto posible se
// resuelve entero, sin política ni promedio. Modelo PARANOICO: los rivales
// eligen lo peor para mí. Es pesimista a propósito —repartir la culpa entre
// tres rivales que no se coordinan no tiene una respuesta exacta— y es la
// aproximación que no se equivoca en el sentido caro.
function buscarExacto(obs, est, ctx) {
  const nJug = est.manos.length;
  const sinPresupuesto = ctx.nodos++ > MAESTRO.exactoNodos
    || ((ctx.nodos & 255) === 0 && Date.now() - ctx.t0 > MAESTRO.topeMs);
  if (sinPresupuesto) {
    ctx.agotado = true;
    return valorTerminal(obs, est, -1);
  }

  const mano = est.manos[est.turno];
  if (mano.length === 0) return valorTerminal(obs, est, est.turno);

  let jugadas = legalesEn(est, mano);
  const robadas = [];
  while (jugadas.length === 0 && obs.drawEnabled && est.pozo.length > 0) {
    const t = est.pozo.pop();
    robadas.push(t);
    mano.push(t);
    jugadas = legalesEn(est, mano);
  }

  const soyYo = obs.orden[est.turno] === obs.playerId
    || (obs.teamsEnabled && obs.equipos[obs.orden[est.turno]] === obs.miEquipo);

  let valor;
  if (jugadas.length === 0) {
    est.pases++;
    if (est.pases >= nJug) {
      valor = valorTerminal(obs, est, -1);
    } else {
      const turnoPrev = est.turno;
      est.turno = (est.turno + est.paso + nJug) % nJug;
      valor = buscarExacto(obs, est, ctx);
      est.turno = turnoPrev;
    }
    est.pases--;
  } else {
    valor = soyYo ? -Infinity : Infinity;
    const pasesPrev = est.pases;
    for (const j of jugadas) {
      const tile = mano[j.i];
      const izqPrev = est.izq;
      const derPrev = est.der;
      aplicarEn(est, j);
      est.pases = 0;
      let v;
      if (est.manos[est.turno].length === 0) {
        v = valorTerminal(obs, est, est.turno);
      } else {
        const turnoPrev = est.turno;
        est.turno = (est.turno + est.paso + nJug) % nJug;
        v = buscarExacto(obs, est, ctx);
        est.turno = turnoPrev;
      }
      mano.splice(j.i, 0, tile);
      est.izq = izqPrev;
      est.der = derPrev;
      est.pases = pasesPrev;
      if (soyYo) { if (v > valor) valor = v; } else if (v < valor) valor = v;
      if (ctx.agotado) break;
    }
    if (valor === -Infinity || valor === Infinity) valor = valorTerminal(obs, est, -1);
  }

  // Deshacer los robos para que el hermano de la búsqueda vea el mismo pozo.
  while (robadas.length) {
    mano.pop();
    est.pozo.push(robadas.pop());
  }
  return valor;
}

// Enumera repartos consistentes para el final exacto. Con pocas no vistas son
// pocos: se cortan a exactoRepartos por si la variante doble 9 se pone tonta.
function repartosExactos(obs) {
  const otros = obs.orden.filter(id => id !== obs.playerId);
  const salida = [];
  const pool = obs.unseen.map(t => [t[0], t[1]]);

  function reparte(idx, restantes, acumulado) {
    if (salida.length >= MAESTRO.exactoRepartos) return;
    if (idx === otros.length) {
      salida.push({ manos: acumulado, pozo: restantes });
      return;
    }
    const id = otros[idx];
    const k = obs.handCounts[id];
    combinar(restantes, k, (elegidas, sobras) => {
      if (salida.length >= MAESTRO.exactoRepartos) return;
      reparte(idx + 1, sobras, { ...acumulado, [id]: elegidas });
    });
  }

  function combinar(lista, k, cb) {
    if (k === 0) return cb([], lista);
    if (lista.length < k) return cb(lista.slice(), []);
    const idxs = [];
    const rec = (inicio) => {
      if (salida.length >= MAESTRO.exactoRepartos) return;
      if (idxs.length === k) {
        const elegidas = idxs.map(i => lista[i]);
        const sobras = lista.filter((_, i) => !idxs.includes(i));
        cb(elegidas, sobras);
        return;
      }
      for (let i = inicio; i < lista.length; i++) {
        idxs.push(i);
        rec(i + 1);
        idxs.pop();
        if (salida.length >= MAESTRO.exactoRepartos) return;
      }
    };
    rec(0);
  }

  reparte(0, pool, {});
  return salida;
}

// 'maestro': la heurística de 'dificil' como prior, corregida por lo que dicen
// los repartos muestreados. El muestreo es lo que le enseña a CERRAR: una
// tranca solo sale a cuenta si la cuenta sale, y eso no se ve en una fórmula
// de una jugada. Si se agota el presupuesto de tiempo, se queda con la
// heurística (que ya es 'dificil') en vez de estirar el turno.
function decidirMaestro(obs) {
  const t0 = Date.now();
  const candidatas = obs.movimientos
    .map(mv => ({ mv, heur: puntuarDificil(obs, mv), total: 0, muestras: 0 }))
    .sort((x, y) => y.heur - x.heur);

  if (candidatas.length === 1) return candidatas[0].mv;
  const podadas = candidatas.slice(0, MAESTRO.candidatas);

  const exacto = obs.miManoCount <= MAESTRO.exactoManoMax
    && obs.unseenCount <= MAESTRO.exactoUnseenMax
    && !obs.tableroVacio;

  const repartos = exacto
    ? repartosExactos(obs)
    : (() => {
      const rnd = azarDesde(semillaDe(obs));
      const out = [];
      for (let i = 0; i < MAESTRO.muestras; i++) out.push(muestrearReparto(obs, rnd));
      return out;
    })();

  const ctx = { nodos: 0, t0, agotado: false };
  for (const reparto of repartos) {
    if (Date.now() - t0 > MAESTRO.objetivoMs && podadas[0].muestras > 0) break;
    for (const c of podadas) {
      const est = crearEstado(obs, reparto);
      const mano = est.manos[obs.miIndice];
      const tile = mano[c.mv.tileIndex];
      if (!tile) continue;
      aplicarEn(est, { i: c.mv.tileIndex, side: c.mv.side });
      est.pases = 0;
      let v;
      if (mano.length === 0) {
        v = valorTerminal(obs, est, obs.miIndice);
      } else {
        est.turno = (est.turno + est.paso + est.manos.length) % est.manos.length;
        v = exacto ? buscarExacto(obs, est, ctx) : simularRonda(obs, est);
      }
      c.total += v;
      c.muestras++;
    }
    if (ctx.agotado) break;
  }

  let mejor = podadas[0];
  let mejorV = -Infinity;
  for (const c of podadas) {
    const media = c.muestras > 0 ? c.total / c.muestras : 0;
    const v = c.heur + MAESTRO.pesoMuestreo * media;
    if (v > mejorV) { mejorV = v; mejor = c; }
  }
  return mejor.mv;
}

function elegirPorHeuristica(obs, puntuar) {
  let mejor = obs.movimientos[0];
  let mejorS = -Infinity;
  for (const mv of obs.movimientos) {
    const s = puntuar(obs, mv);
    if (s > mejorS) { mejorS = s; mejor = mv; }
  }
  return mejor;
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

// Decide la jugada del bot. ÚNICO punto donde entra el objeto DominoGame, y
// solo para construir la observación pública.
function chooseMove(game, playerId) {
  const obs = buildObservation(game, playerId);
  if (!obs || obs.movimientos.length === 0) return null;

  let mv;
  switch (obs.nivel) {
    case 'facil': mv = elegirPorHeuristica(obs, puntuarFacil); break;
    case 'dificil': mv = elegirPorHeuristica(obs, puntuarDificil); break;
    case 'maestro': mv = decidirMaestro(obs); break;
    default: mv = elegirPorHeuristica(obs, puntuarNormal); break;
  }
  return mv ? { tileIndex: mv.tileIndex, side: mv.side } : null;
}

// Compatibilidad: la firma histórica (game, player, move, difficulty). Ya no la
// usa el cerebro —que puntúa sobre la observación—, pero sigue exportada porque
// es API pública del módulo desde la primera versión.
function scoreMove(game, player, move, difficulty) {
  const obs = buildObservation(game, player.id);
  if (!obs) return -Infinity;
  const mv = obs.movimientos.find(m => m.tileIndex === move.tileIndex && m.side === move.side);
  if (!mv) return -Infinity;
  const nivel = difficulty || obs.nivel;
  if (nivel === 'facil') return puntuarFacil(obs, mv);
  if (nivel === 'dificil' || nivel === 'maestro') return puntuarDificil(obs, mv);
  return puntuarNormal(obs, mv);
}

// Qué extremo congelar. Congelar es EL poder táctico del dominó: bloquea a los
// rivales el extremo que sí podían jugar. Se elige el que más probablemente les
// sirve (probabilidad hipergeométrica sobre las no vistas, con los pases como
// certeza), no uno al azar. Devuelve null si no hay tablero que congelar.
function chooseFreezeEnd(game, botId) {
  const obs = buildObservation(game, botId);
  if (!obs || obs.tableroVacio) return null;
  const riesgo = valor => obs.rivals.reduce((s, id) => s + obs.pTiene(id, valor), 0);
  const rIzq = riesgo(obs.izq);
  const rDer = riesgo(obs.der);
  if (rDer > rIzq) return 'right';
  return 'left';
}

function choosePower(game, playerId, random = Math.random) {
  const player = game.players.find(p => p.id === playerId);
  if (!player || !game.powersEnabled) return null;
  const diff = player.difficulty || 'normal';
  if (diff === 'facil') return null;
  if (!player.powers || player.powers.length === 0) return null;

  // Congelar sin tablero no congela nada: se descarta antes de gastar la tirada.
  const hayTablero = (game.board || []).length > 0;
  const usable = player.powers.filter(c =>
    SAFE_BOT_POWERS.includes(c.id) && (c.id !== 'freeze' || hayTablero)
  );
  if (usable.length === 0) return null;

  // Cuanto mejor es el bot, más aprovecha las cartas que tiene.
  const threshold = diff === 'maestro' ? 0.6 : (diff === 'dificil' ? 0.45 : 0.3);
  if (random() > threshold) return null;

  return usable[Math.floor(random() * usable.length)].id;
}

// Cuánto "piensa" el bot antes de jugar. No es cosmética: el ritmo es la señal
// por la que un jugador nota que el rival de enfrente no es el mismo de antes.
// Se alarga en las jugadas críticas —pozo seco con alguien a punto de cerrar, o
// yo mismo rematando—, que es justo donde un humano también se lo piensa.
const RITMO = {
  facil: [350, 650],
  normal: [700, 1200],
  dificil: [950, 1700],
  maestro: [1400, 2400]
};
const RITMO_CRITICO_MS = 900;

function ritmoDePensarMs(game, bot, random = Math.random) {
  const tramo = RITMO[bot && bot.difficulty] || RITMO.normal;
  let ms = tramo[0] + Math.floor(random() * (tramo[1] - tramo[0]));

  // Solo dominó tiene pozo y manos de fichas; otros juegos usan el tramo base.
  // Esta función mira el juego directamente, pero solo TAMAÑOS (que ya viajan
  // en el estado público como boneyardCount y handCount) y solo para decidir
  // cuántos milisegundos espera el temporizador: no toca ninguna decisión.
  const pozoSeco = Array.isArray(game.boneyard) && game.boneyard.length === 0;
  if (pozoSeco && Array.isArray(game.players)) {
    const remate = game.players.some(p => p.hand && p.hand.length > 0 && p.hand.length <= 2);
    if (remate) ms += RITMO_CRITICO_MS;
  }
  return ms;
}

module.exports = {
  chooseMove,
  choosePower,
  chooseFreezeEnd,
  pickBotName,
  scoreMove,
  ritmoDePensarMs,
  BOT_NAMES,
  SAFE_BOT_POWERS,
  // La tabla de pesos se exporta POR REFERENCIA para que testBotLevels.js pueda
  // anularlos y comprobar que cada capacidad de «difícil» influye de verdad en la
  // decisión. Hizo falta: una auditoría por mutación demostró que poniendo
  // bloqueoRival, abrirRival o sinSalida a cero la suite seguía en verde, o sea que
  // las capacidades no tenían cobertura ninguna. No la mutes fuera de un test, y
  // restaura siempre lo que cambies.
  P
};
