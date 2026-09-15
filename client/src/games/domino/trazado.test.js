import { describe, it, expect } from 'vitest';
import {
  trazarSerpiente,
  elegirPerRow,
  escalaDeVista,
  fichasDelMazo,
  longitudMaximaDeCadena,
  cadenaMasAncha,
  cajaDeLaJugada,
  maxPipDelMazo,
} from './trazado';

// Geometría del :root de base.css. Se pasa explícita para que el test no
// dependa de que haya CSS cargado (en jsdom no lo hay).
const GEOM = { largo: 96, corto: 52, hueco: 8, margen: 8 };
const ESC_MAX = 1.35;

// ---------------------------------------------------------------------------
// Generadores de cadenas VÁLIDAS
//
// Válida = el valor derecho de cada ficha es el izquierdo de la siguiente. Sin
// eso el trazado mide una figura que no puede existir sobre la mesa, y todas
// las cifras que salieran de aquí serían decoración.
// ---------------------------------------------------------------------------

function esCadenaValida(cadena) {
  for (let i = 0; i + 1 < cadena.length; i++) {
    if (cadena[i][1] !== cadena[i + 1][0]) return false;
  }
  return true;
}

/** Todas las fichas de un mazo doble-maxPip, como pares [a, b] con a <= b. */
function mazo(maxPip) {
  const fichas = [];
  for (let a = 0; a <= maxPip; a++) for (let b = a; b <= maxPip; b++) fichas.push([a, b]);
  return fichas;
}

/**
 * Cadena MÁXIMA de un mazo, por Hierholzer.
 *
 * El dominó es un grafo con un vértice por número y una arista por ficha (los
 * dobles son bucles), así que la cadena más larga es un camino euleriano. Con
 * maxPip impar los maxPip+1 vértices tienen grado impar y hay que sacrificar
 * (maxPip-1)/2 fichas para dejar solo 2: por eso doble-9 da 51 y no 55.
 */
function cadenaMaxima(maxPip) {
  const v = maxPip + 1;
  const grado = new Array(v).fill(0);
  const aristas = mazo(maxPip);
  for (const [a, b] of aristas) {
    if (a === b) grado[a] += 2;
    else { grado[a] += 1; grado[b] += 1; }
  }
  const impares = [];
  for (let i = 0; i < v; i++) if (grado[i] % 2 === 1) impares.push(i);
  // Se emparejan los impares de dos en dos dejando la última pareja viva.
  const fuera = new Set();
  for (let i = 0; i + 3 <= impares.length; i += 2) {
    const a = Math.min(impares[i], impares[i + 1]);
    const b = Math.max(impares[i], impares[i + 1]);
    fuera.add(`${a}-${b}`);
    grado[a] -= 1;
    grado[b] -= 1;
  }
  const usables = aristas.filter(([a, b]) => !fuera.has(`${a}-${b}`));
  const adj = Array.from({ length: v }, () => []);
  usables.forEach(([a, b], i) => {
    adj[a].push([b, i]);
    if (a !== b) adj[b].push([a, i]);
  });
  const gastada = new Array(usables.length).fill(false);
  const cursor = new Array(v).fill(0);
  let inicio = 0;
  for (let i = 0; i < v; i++) if (grado[i] % 2 === 1) { inicio = i; break; }
  const pila = [inicio];
  const recorrido = [];
  while (pila.length) {
    const nodo = pila[pila.length - 1];
    while (cursor[nodo] < adj[nodo].length && gastada[adj[nodo][cursor[nodo]][1]]) cursor[nodo] += 1;
    if (cursor[nodo] === adj[nodo].length) recorrido.push(pila.pop());
    else {
      const [siguiente, i] = adj[nodo][cursor[nodo]];
      gastada[i] = true;
      pila.push(siguiente);
    }
  }
  recorrido.reverse();
  const cadena = [];
  for (let i = 0; i + 1 < recorrido.length; i++) cadena.push([recorrido[i], recorrido[i + 1]]);
  return cadena;
}

// xorshift: hace falta que el barrido aleatorio sea reproducible. Un fallo que
// no se puede volver a provocar no sirve para arreglar nada.
function azar(semilla) {
  let s = semilla | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
    return Math.abs(s) / 2147483647;
  };
}

/** Cadena válida aleatoria con fichas REALES del mazo, sin repetir ninguna. */
function cadenaAleatoria(n, maxPip, rnd) {
  const libres = mazo(maxPip);
  const [x, y] = libres.splice(Math.floor(rnd() * libres.length), 1)[0];
  const cadena = [rnd() < 0.5 ? [x, y] : [y, x]];
  while (cadena.length < n) {
    const der = cadena[cadena.length - 1][1];
    const candidatas = [];
    libres.forEach((f, i) => { if (f[0] === der || f[1] === der) candidatas.push(i); });
    if (!candidatas.length) break; // tranca: la cadena se acabó antes de tiempo
    const f = libres.splice(candidatas[Math.floor(rnd() * candidatas.length)], 1)[0];
    cadena.push(f[0] === der ? [f[0], f[1]] : [f[1], f[0]]);
  }
  return cadena;
}

// ---------------------------------------------------------------------------
// Los 6 anchos del encargo, con la pila vertical del spec (§2.1) para deducir
// el alto de la mesa: barra 40 + cinta 56 + riel 56 + mano 116 + 16 de aire.
// ---------------------------------------------------------------------------
const ESCENARIOS = [
  { nombre: '320x568', ancho: 320, alto: 284, padX: 12, padY: 8, escMin: 0.70 },
  { nombre: '375x812', ancho: 375, alto: 528, padX: 12, padY: 8, escMin: 0.70 },
  { nombre: '390x844', ancho: 390, alto: 560, padX: 12, padY: 8, escMin: 0.70 },
  { nombre: '414x896', ancho: 414, alto: 612, padX: 12, padY: 8, escMin: 0.70 },
  { nombre: '768x1024', ancho: 768, alto: 714, padX: 16, padY: 12, escMin: 0.80 },
  { nombre: '1440x900', ancho: 1440, alto: 552, padX: 24, padY: 16, escMin: 0.85 },
];

const util = (e) => ({ uW: e.ancho - 2 * e.padX, uH: e.alto - 2 * e.padY });

/** perRow que elegiría la mesa para ese escenario y ese mazo. */
function perRowDe(escenario, maxPip) {
  const { uW, uH } = util(escenario);
  return elegirPerRow(fichasDelMazo(maxPip), maxPip, uW, uH, escenario.escMin, ESC_MAX, GEOM);
}

/** Separación entre dos fichas: negativa solo si se solapan de verdad. */
function separacion(a, b) {
  const dx = Math.abs(a.cx - b.cx) - (a.w + b.w) / 2;
  const dy = Math.abs(a.cy - b.cy) - (a.h + b.h) / 2;
  return Math.max(dx, dy);
}

describe('trazado · cadenas de prueba', () => {
  it('las cadenas de los tests son válidas de verdad', () => {
    // Si este test no existiera, todos los demás podrían estar midiendo figuras
    // imposibles y saldrían igual de verdes.
    expect(esCadenaValida(cadenaMaxima(6))).toBe(true);
    expect(esCadenaValida(cadenaMaxima(9))).toBe(true);
    expect(esCadenaValida(cadenaMasAncha(28, 6))).toBe(true);
    const rnd = azar(4242);
    for (let i = 0; i < 50; i++) {
      expect(esCadenaValida(cadenaAleatoria(28, 6, rnd))).toBe(true);
      expect(esCadenaValida(cadenaAleatoria(51, 9, rnd))).toBe(true);
    }
    // Y la de peor caso no lleva ningún doble: es su razón de ser.
    expect(cadenaMasAncha(28, 6).some(([a, b]) => a === b)).toBe(false);
  });

  it('el mazo de doble-9 tiene 55 fichas pero su cadena máxima es de 51', () => {
    // K10 tiene 10 vértices de grado impar, así que hay que dejar 4 fichas
    // fuera. Es el número que fija el techo de todos los cálculos de doble-9.
    expect(fichasDelMazo(6)).toBe(28);
    expect(fichasDelMazo(9)).toBe(55);
    expect(longitudMaximaDeCadena(6)).toBe(28);
    expect(longitudMaximaDeCadena(9)).toBe(51);

    const cadena = cadenaMaxima(9);
    expect(cadena).toHaveLength(51);
    // Construida, no postulada: 51 fichas distintas y encadenadas.
    const vistas = new Set(cadena.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
    expect(vistas.size).toBe(51);
    expect(cadenaMaxima(6)).toHaveLength(28);
    expect(maxPipDelMazo(28)).toBe(6);
    expect(maxPipDelMazo(55)).toBe(9);
  });
});

describe('trazado · geometría', () => {
  it('un tablero vacío no traza nada y no revienta', () => {
    const vacio = trazarSerpiente([], { ...GEOM, perRow: 4 });
    expect(vacio.items).toEqual([]);
    expect(vacio.w).toBe(0);
    expect(vacio.leftPos).toBeNull();
    expect(trazarSerpiente(null, { ...GEOM, perRow: 4 }).items).toEqual([]);
  });

  it('la caja incluye el margen y minX/minY sitúan a la primera ficha dentro', () => {
    const trazo = trazarSerpiente(cadenaMaxima(6).slice(0, 9), { ...GEOM, perRow: 4 });
    for (const it of trazo.items) {
      const izq = it.cx - it.w / 2 - trazo.minX + GEOM.margen;
      const arr = it.cy - it.h / 2 - trazo.minY + GEOM.margen;
      expect(izq).toBeGreaterThanOrEqual(GEOM.margen - 0.001);
      expect(arr).toBeGreaterThanOrEqual(GEOM.margen - 0.001);
      expect(izq + it.w).toBeLessThanOrEqual(trazo.w - GEOM.margen + 0.001);
      expect(arr + it.h).toBeLessThanOrEqual(trazo.h - GEOM.margen + 0.001);
    }
  });

  it('el doble justo antes de una esquina deja hueco en vez de fundirse con ella', () => {
    // Defecto original: dir*(prev.w/2 - HALF_S) vale 0 cuando la ficha previa es
    // un doble, así que la esquina heredaba su columna exacta y las dos
    // verticales quedaban en línea: el giro en L no se leía.
    const conDoble = [[0, 1], [1, 2], [2, 3], [3, 3], [3, 4], [4, 5]];
    const trazo = trazarSerpiente(conDoble, { ...GEOM, perRow: 4 });
    const doble = trazo.items[3];
    const esquina = trazo.items[4];
    expect(doble.horizontal).toBe(false);
    expect(esquina.isCorner).toBe(true);
    expect(Math.abs(esquina.cx - doble.cx)).toBe(GEOM.corto / 2);
    // Y con la previa acostada la esquina sigue enrasando con el final de fila.
    const sinDoble = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]];
    const t2 = trazarSerpiente(sinDoble, { ...GEOM, perRow: 4 });
    const previa = t2.items[3];
    expect(t2.items[4].cx + t2.items[4].w / 2).toBeCloseTo(previa.cx + previa.w / 2, 6);
  });

  it('ninguna ficha se solapa y las no consecutivas guardan 12 px', () => {
    // 12 px lógicos es la separación mínima entre filas. Antes eran 0: dos
    // dobles de filas contiguas quedaban con los bordes pegados y a escala 0,7
    // se leían como una sola pieza rota.
    const rnd = azar(90210);
    let minNoConsecutivas = Infinity;
    let minTotal = Infinity;
    for (let caso = 0; caso < 500; caso++) {
      const maxPip = caso % 2 === 0 ? 6 : 9;
      const cadena = cadenaAleatoria(maxPip === 6 ? 28 : 51, maxPip, rnd);
      const perRow = 2 + (caso % 8);
      const { items } = trazarSerpiente(cadena, { ...GEOM, perRow });
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const sep = separacion(items[i], items[j]);
          if (sep < minTotal) minTotal = sep;
          if (j > i + 1 && sep < minNoConsecutivas) minNoConsecutivas = sep;
        }
      }
    }
    expect(minTotal).toBeGreaterThanOrEqual(0);
    expect(minNoConsecutivas).toBeGreaterThanOrEqual(12);
  });
});

describe('trazado · presupuesto de la mesa', () => {
  it('perRow sale 4 en móvil, 5 en tablet y 9 en escritorio con doble-6', () => {
    expect(perRowDe(ESCENARIOS[1], 6)).toBe(4);   // 375
    expect(perRowDe(ESCENARIOS[4], 6)).toBe(5);   // 768
    expect(perRowDe(ESCENARIOS[5], 6)).toBe(9);   // 1440
  });

  it('la restricción dura se mide contra la caja REAL, no contra un ancho de fila nominal', () => {
    // A 320 px la diferencia se ve: la fila nominal de 4 fichas dice 408 px
    // (4*104-8) y a 0,70 cabría de sobra en los 296 útiles, pero la caja real
    // mide 484 px porque las esquinas asoman por el lado izquierdo de cada fila.
    // Medir contra el nominal elegiría perRow 4 y la mesa acabaría por debajo
    // del suelo de legibilidad.
    const estrecho = ESCENARIOS[0]; // 320x568
    const { uW } = util(estrecho);
    const nominal = 4 * (GEOM.largo + GEOM.hueco) - GEOM.hueco;
    const real = trazarSerpiente(cadenaMasAncha(28, 6), { ...GEOM, perRow: 4 }).w;
    expect(nominal).toBe(408);
    expect(real).toBe(484);
    expect(nominal * estrecho.escMin).toBeLessThanOrEqual(uW); // el nominal engaña
    expect(real * estrecho.escMin).toBeGreaterThan(uW);        // la caja real, no
    expect(perRowDe(estrecho, 6)).toBe(3);
  });

  it('el perRow elegido siempre deja caber la cadena prevista al suelo de escala', () => {
    // Es la razón de ser de elegirPerRow: si esto falla, el suelo de legibilidad
    // y el ancho de la pantalla se contradicen y alguien tiene que ceder.
    for (const escenario of ESCENARIOS) {
      const { uW } = util(escenario);
      for (const maxPip of [6, 9]) {
        const perRow = perRowDe(escenario, maxPip);
        const previsto = trazarSerpiente(
          cadenaMasAncha(longitudMaximaDeCadena(maxPip), maxPip),
          { ...GEOM, perRow }
        );
        expect(
          previsto.w * escenario.escMin,
          `${escenario.nombre} doble-${maxPip} perRow=${perRow}`
        ).toBeLessThanOrEqual(uW + 0.001);
      }
    }
  });

  it('la tabla de escalas del spec sale clavada en móvil, escritorio y portátil', () => {
    // Réplica de la tabla del spec §1.4 sobre la cadena máxima del mazo.
    const casos = [
      { esc: ESCENARIOS[1], maxPip: 6, n: 1, escala: 1.350 },
      { esc: ESCENARIOS[1], maxPip: 6, n: 3, escala: 1.272 },
      { esc: ESCENARIOS[1], maxPip: 6, n: 7, escala: 0.924 },
      { esc: ESCENARIOS[1], maxPip: 6, n: 14, escala: 0.725 },
      { esc: ESCENARIOS[1], maxPip: 6, n: 28, escala: 0.725 },
      { esc: ESCENARIOS[5], maxPip: 6, n: 28, escala: 1.350 },
      { esc: ESCENARIOS[5], maxPip: 9, n: 51, escala: 1.134 },
      // Portátil 1280x800: mesa 480 con la misma pila de escritorio.
      { esc: { ancho: 1280, alto: 480, padX: 24, padY: 16, escMin: 0.85 }, maxPip: 6, n: 28, escala: 1.345 },
      { esc: { ancho: 1280, alto: 480, padX: 24, padY: 16, escMin: 0.85 }, maxPip: 9, n: 51, escala: 1.003 },
    ];
    for (const caso of casos) {
      const { uW, uH } = util(caso.esc);
      const perRow = perRowDe(caso.esc, caso.maxPip);
      const trazo = trazarSerpiente(cadenaMaxima(caso.maxPip).slice(0, caso.n), { ...GEOM, perRow });
      const escala = escalaDeVista(trazo, uW, uH, caso.esc.escMin, ESC_MAX);
      expect(escala).toBeCloseTo(caso.escala, 3);
    }
  });

  it('la ficha del tablero lleno mide 70x38 en móvil, no 34x18', () => {
    // Es el número que justifica el rediseño entero.
    const { uW, uH } = util(ESCENARIOS[1]);
    const trazo = trazarSerpiente(cadenaMaxima(6), { ...GEOM, perRow: perRowDe(ESCENARIOS[1], 6) });
    const escala = escalaDeVista(trazo, uW, uH, ESCENARIOS[1].escMin, ESC_MAX);
    expect(Math.round(GEOM.largo * escala)).toBe(70);
    expect(Math.round(GEOM.corto * escala)).toBe(38);
    expect(6 * escala).toBeGreaterThan(4.2); // el pip, hoy en 2,10 px
  });

  it('perRow no se mueve dentro de una ronda: no depende del tablero', () => {
    // Es lo que evita el rebarajado visual a media partida. elegirPerRow no
    // recibe el tablero por diseño: solo el mazo y el contenedor.
    const { uW, uH } = util(ESCENARIOS[1]);
    const a = elegirPerRow(28, 6, uW, uH, 0.7, ESC_MAX, GEOM);
    const b = elegirPerRow(28, 6, uW, uH, 0.7, ESC_MAX, GEOM);
    expect(a).toBe(b);
    // Y sí se mueve cuando cambia el mazo o el contenedor, que es cuando debe.
    expect(elegirPerRow(55, 9, uW, uH, 0.7, ESC_MAX, GEOM)).not.toBe(0);
    expect(elegirPerRow(28, 6, 1392, 520, 0.85, ESC_MAX, GEOM)).toBe(9);
  });

  it('sin contenedor medido devuelve un perRow usable en vez de NaN', () => {
    expect(elegirPerRow(28, 6, 0, 0, 0.7, ESC_MAX, GEOM)).toBeGreaterThanOrEqual(2);
    expect(escalaDeVista(null, 351, 512, 0.7, ESC_MAX)).toBe(0.7);
    expect(escalaDeVista({ w: 484, h: 674 }, 0, 0, 0.7, ESC_MAX)).toBe(0.7);
  });

  it('la escala respeta el techo y solo baja del suelo para no desbordar', () => {
    // Techo: una ficha sola en un escritorio no crece sin fin.
    expect(escalaDeVista({ w: 112, h: 68 }, 1392, 520, 0.85, ESC_MAX)).toBe(ESC_MAX);
    // Suelo: sobra ancho, así que el suelo manda y el sobrante cae en vertical.
    expect(escalaDeVista({ w: 400, h: 3000 }, 351, 512, 0.7, ESC_MAX)).toBe(0.7);
    // Salvo que respetarlo dejara media mesa fuera de pantalla.
    expect(escalaDeVista({ w: 700, h: 3000 }, 351, 512, 0.7, ESC_MAX)).toBeCloseTo(351 / 700, 6);
  });
});

describe('trazado · encuadre de la cámara', () => {
  it('la franja a enseñar cae dentro del lienzo y contiene la última ficha', () => {
    // Es la aritmética que manda a la cámara: si se olvidara el `- minY` o la
    // escala, la mesa se desplazaría a un sitio donde no hay nada que ver, y en
    // pantalla eso se lee como "el tablero ha desaparecido".
    const { uW, uH } = util(ESCENARIOS[1]);
    const perRow = perRowDe(ESCENARIOS[1], 9);
    const cadena = cadenaMaxima(9);
    for (const n of [1, 5, 17, 33, 51]) {
      const trazo = trazarSerpiente(cadena.slice(0, n), { ...GEOM, perRow });
      const escala = escalaDeVista(trazo, uW, uH, ESCENARIOS[1].escMin, ESC_MAX);
      const ultima = trazo.items[trazo.items.length - 1];
      const caja = cajaDeLaJugada(trazo, escala, GEOM.margen, ultima);
      expect(caja.arriba).toBeLessThanOrEqual(caja.abajo);
      expect(caja.arriba).toBeGreaterThanOrEqual(0);
      expect(caja.abajo).toBeLessThanOrEqual(trazo.h * escala + 0.001);
      // Y la última ficha está dentro de verdad, no sólo la caja dentro del lienzo.
      const centroUltima = (ultima.cy - trazo.minY + GEOM.margen) * escala;
      expect(centroUltima).toBeGreaterThanOrEqual(caja.arriba - 0.001);
      expect(centroUltima).toBeLessThanOrEqual(caja.abajo + 0.001);
    }
  });

  it('sin tablero no hay nada que encuadrar', () => {
    expect(cajaDeLaJugada(trazarSerpiente([], { ...GEOM, perRow: 4 }), 1, 8, null)).toBeNull();
    expect(cajaDeLaJugada(null, 1, 8, null)).toBeNull();
  });
});

describe('trazado · invariante dura: la mesa nunca desborda a lo ancho', () => {
  it('con la cadena máxima del mazo, en los 6 anchos y para toda cantidad de fichas', () => {
    for (const escenario of ESCENARIOS) {
      const { uW, uH } = util(escenario);
      for (const maxPip of [6, 9]) {
        const perRow = perRowDe(escenario, maxPip);
        const cadena = cadenaMaxima(maxPip);
        for (let n = 1; n <= cadena.length; n++) {
          const trazo = trazarSerpiente(cadena.slice(0, n), { ...GEOM, perRow });
          const escala = escalaDeVista(trazo, uW, uH, escenario.escMin, ESC_MAX);
          expect(
            trazo.w * escala,
            `${escenario.nombre} doble-${maxPip} n=${n} perRow=${perRow}`
          ).toBeLessThanOrEqual(uW + 0.001);
        }
      }
    }
  });

  it('con 1, 7, 12, 20 y 28 fichas de doble-6 y hasta 51 de doble-9, en cadenas aleatorias', () => {
    // El tablero real no es la cadena que midió el diseño: los dobles acortan
    // su fila, así que las filas dejan de medir lo mismo y el zigzag deriva.
    // Aquí es donde se comprueba que aun así no se sale ni un píxel.
    const rnd = azar(31337);
    for (const escenario of ESCENARIOS) {
      const { uW, uH } = util(escenario);
      for (const [maxPip, cuentas] of [[6, [1, 7, 12, 20, 28]], [9, [1, 7, 12, 20, 28, 40, 51]]]) {
        const perRow = perRowDe(escenario, maxPip);
        for (let caso = 0; caso < 40; caso++) {
          const completa = cadenaAleatoria(51, maxPip, rnd);
          for (const n of cuentas) {
            if (n > completa.length) continue;
            const trazo = trazarSerpiente(completa.slice(0, n), { ...GEOM, perRow });
            const escala = escalaDeVista(trazo, uW, uH, escenario.escMin, ESC_MAX);
            expect(
              trazo.w * escala,
              `${escenario.nombre} doble-${maxPip} n=${n} perRow=${perRow} caso=${caso}`
            ).toBeLessThanOrEqual(uW + 0.001);
          }
        }
      }
    }
  });

  it('el sobrante cae SIEMPRE en vertical, que es el eje con scroll', () => {
    // La contrapartida honesta de no desbordar nunca a lo ancho.
    const { uW, uH } = util(ESCENARIOS[1]);
    const perRow = perRowDe(ESCENARIOS[1], 9);
    const trazo = trazarSerpiente(cadenaMaxima(9), { ...GEOM, perRow });
    const escala = escalaDeVista(trazo, uW, uH, 0.7, ESC_MAX);
    expect(trazo.w * escala).toBeLessThanOrEqual(uW);
    expect(trazo.h * escala).toBeGreaterThan(uH); // doble-9 lleno en un móvil no cabe, y se dice
  });

  it('la caja no decrece al añadir fichas: por eso basta comprobar la cadena entera', () => {
    const cadena = cadenaMaxima(9);
    for (const perRow of [2, 3, 4, 6, 9, 12]) {
      let anterior = 0;
      for (let n = 1; n <= cadena.length; n++) {
        const { w } = trazarSerpiente(cadena.slice(0, n), { ...GEOM, perRow });
        expect(w).toBeGreaterThanOrEqual(anterior);
        anterior = w;
      }
    }
  });
});
