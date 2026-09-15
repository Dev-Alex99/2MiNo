// Trazado de la serpiente del tablero de dominó.
//
// Sale de GameBoard.jsx (computeSnakeLayout) para poder medirlo: la geometría
// del tablero era la única parte de la app sin un solo test, y era justo donde
// vivía el fallo raíz —`perRow` se decidía con el ancho completo del contenedor
// mientras la escala se medía contra otro ancho distinto, así que los dos
// presupuestos no se hablaban y la mesa desbordaba a la vez que dibujaba fichas
// de 34x18 px—. Aquí dentro no hay React ni DOM: entra una cadena de fichas y
// salen números.

// Respaldo de geometría: los mismos valores que el :root de base.css. Quien
// pinta de verdad pasa la geometría leída con leerGeometria(); estos existen
// para que el módulo y sus tests funcionen sin CSS cargado.
const GEOMETRIA_POR_DEFECTO = { largo: 96, corto: 52, hueco: 8, margen: 8 };
const ESC_MIN_POR_DEFECTO = 0.7;
const ESC_MAX_POR_DEFECTO = 1.35;

// Aire vertical que se mete entre el bloque de una fila y el de la siguiente.
// Sin él dos dobles de filas contiguas quedan a 0 px (bordes pegados): la
// geometría no llega a solaparse, pero a escala 0,7 dos fichas tocándose se leen
// como una sola pieza rota.
const AIRE_FILA = 12;

// Rango en el que se busca perRow. Por debajo de 2 la serpiente es una columna
// de esquinas y por encima de 15 ninguna pantalla real admite la fila.
const PER_ROW_MIN = 2;
const PER_ROW_MAX = 15;

// perRow de arranque, para el fotograma en el que todavía no se ha medido el
// contenedor. No se pinta nada con él (el plano va oculto hasta la medida),
// pero evita que el trazado tenga que aceptar un perRow inválido.
const PER_ROW_INICIAL = 4;

/** Número de fichas de un mazo de doble-maxPip: 28 con 6, 55 con 9. */
export function fichasDelMazo(maxPip) {
  const p = Math.max(0, Math.floor(maxPip));
  return ((p + 1) * (p + 2)) / 2;
}

/**
 * Fichas de la cadena más larga que se puede formar con un mazo de doble-maxPip.
 *
 * No es el mazo entero. El grafo del dominó tiene un vértice por número y una
 * arista por ficha, así que una cadena es un camino euleriano: solo existe si
 * hay 0 o 2 vértices de grado impar. Con maxPip par (doble-6) todos los grados
 * son pares y caben las 28. Con maxPip impar (doble-9) los 10 vértices son
 * impares y hay que dejar fuera (10-2)/2 = 4 fichas: la cadena máxima real es de
 * 51, no de 55. Los tests fijan 51 por esto.
 */
export function longitudMaximaDeCadena(maxPip) {
  const p = Math.max(0, Math.floor(maxPip));
  const impares = p % 2 === 1 ? (p - 1) / 2 : 0;
  return fichasDelMazo(p) - impares;
}

/**
 * Cadena válida (el valor derecho de cada ficha es el izquierdo de la siguiente)
 * SIN ningún doble, que es el peor caso de ancho: acostada una ficha ocupa
 * `largo` y un doble solo `corto`, así que cuantos menos dobles haya, más ancha
 * es cada fila. Puede repetir fichas a propósito: su único cometido es acotar el
 * ancho de un perRow dado, no representar un reparto jugable.
 */
export function cadenaMasAncha(n, maxPip) {
  const total = Math.max(0, Math.floor(n));
  const p = Math.max(1, Math.floor(maxPip));
  const fichas = [];
  let a = 0;
  for (let i = 0; i < total; i++) {
    const b = a === p ? 0 : a + 1; // con maxPip >= 1 nunca sale a === b
    fichas.push([a, b]);
    a = b;
  }
  return fichas;
}

/**
 * Traza la serpiente (boustrophedon) de un tablero ya orientado.
 *
 * El tablero llega como una cadena: board[i] = [a, b] con b === board[i+1][0].
 * Se aprovecha para que los puntos "conecten" visualmente, volteando los valores
 * en las filas que van de derecha a izquierda.
 *
 * - Fichas normales: acostadas (horizontal).
 * - Dobles: parados (vertical), como en un dominó real.
 * - Al llenar una fila, la siguiente ficha se coloca PARADA haciendo la esquina
 *   en "L": su borde superior conecta con la fila de arriba y el inferior con la
 *   siguiente, que continúa en sentido inverso.
 *
 * Devuelve la caja ya con `margen` incluido en w/h, y `minX`/`minY` del
 * contenido, para que quien pinte coloque cada ficha en (cx - minX + margen).
 */
export function trazarSerpiente(board, opciones = {}) {
  const {
    perRow = PER_ROW_INICIAL,
    margen = GEOMETRIA_POR_DEFECTO.margen,
    largo = GEOMETRIA_POR_DEFECTO.largo,
    corto = GEOMETRIA_POR_DEFECTO.corto,
    hueco = GEOMETRIA_POR_DEFECTO.hueco,
  } = opciones;

  const porFila = Math.max(1, Math.floor(perRow));
  const MITAD_L = largo / 2;
  const MITAD_C = corto / 2;

  if (!Array.isArray(board) || board.length === 0) {
    return { items: [], leftPos: null, rightPos: null, w: 0, h: 0, minX: 0, minY: 0 };
  }

  const items = [];
  let dir = 1;      // 1 => la fila avanza a la derecha, -1 => a la izquierda
  let enFila = 0;   // fichas ya colocadas en la fila actual
  let filaCy = 0;   // centro vertical de la fila actual
  let prev = null;

  for (let i = 0; i < board.length; i++) {
    const [a, b] = board[i];
    const esDoble = a === b;
    let cx;
    let cy;
    let w;
    let h;
    let horizontal;
    let display;
    let isCorner = false;

    if (prev === null) {
      // Primera ficha: acostada, centrada; la fila arranca hacia la derecha.
      w = largo; h = corto; horizontal = true;
      display = [a, b];
      cx = 0; cy = 0; filaCy = 0; enFila = 1;
    } else if (enFila >= porFila) {
      // GIRO: ficha PARADA que baja a la fila siguiente formando una "L".
      w = corto; h = largo; horizontal = false;
      display = [a, b];
      isCorner = true;
      // Con la ficha previa acostada, este desvío alinea el borde exterior de la
      // esquina con el de la fila. Con la previa PARADA (un doble) valdría 0 y
      // la esquina heredaría su columna exacta: dos verticales en línea y el
      // giro en L deja de leerse. Medio ancho de ficha lo hace visible.
      cx = prev.cx + dir * (prev.horizontal ? prev.w / 2 - MITAD_C : prev.w / 2);
      cy = filaCy + prev.h / 2 + MITAD_L;
      dir = -dir;
      // El aire va aquí y no en `cy` porque la esquina TIENE que tocar la fila
      // de arriba (es la ficha que enlaza las dos filas); lo que no puede tocar
      // es el cuerpo de la fila siguiente.
      filaCy = cy + (MITAD_L - MITAD_C) + AIRE_FILA;
      enFila = 0;
    } else if (esDoble) {
      // Doble parado en línea (no gira).
      w = corto; h = largo; horizontal = false;
      display = [a, b];
      cx = prev.cx + dir * (prev.w / 2 + hueco + MITAD_C);
      cy = filaCy;
      enFila += 1;
    } else {
      // Ficha acostada normal (también la primera de una fila tras una esquina).
      // En filas hacia la izquierda se voltean los valores para que el punto de
      // conexión quede del lado correcto.
      w = largo; h = corto; horizontal = true;
      display = dir === 1 ? [a, b] : [b, a];
      cx = prev.cx + dir * (prev.w / 2 + hueco + MITAD_L);
      cy = filaCy;
      enFila += 1;
    }

    const item = { tile: board[i], display, cx, cy, w, h, horizontal, dir, isCorner };
    items.push(item);
    prev = item;
  }

  // Puntos de enganche de los dos extremos abiertos: el borde exterior de la
  // cadena más el hueco que dejaría la ficha siguiente. Ya no llevan el radio de
  // los círculos de extremo (PL = 32): esos círculos desaparecen del lienzo y se
  // convierten en los dos botones del riel, que viven en espacio de pantalla.
  // Se siguen calculando porque los necesita la cámara para seguir la jugada.
  const primera = items[0];
  const leftPos = { x: primera.cx - primera.w / 2 - hueco, y: primera.cy };
  const ultima = items[items.length - 1];
  const rightPos = {
    x: ultima.cx + ultima.dir * (ultima.w / 2 + hueco),
    // Si la última ficha es una esquina, el crecimiento sale por debajo de ella.
    y: ultima.isCorner ? ultima.cy + (MITAD_L - MITAD_C) : ultima.cy,
  };

  // Límites del contenido: SOLO las fichas. La caja se cierra con `margen`.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    if (it.cx - it.w / 2 < minX) minX = it.cx - it.w / 2;
    if (it.cx + it.w / 2 > maxX) maxX = it.cx + it.w / 2;
    if (it.cy - it.h / 2 < minY) minY = it.cy - it.h / 2;
    if (it.cy + it.h / 2 > maxY) maxY = it.cy + it.h / 2;
  }

  // Centrado respecto a (0,0), como hacía el trazado original.
  const centroX = (minX + maxX) / 2;
  const centroY = (minY + maxY) / 2;
  for (const it of items) {
    it.cx -= centroX;
    it.cy -= centroY;
  }
  leftPos.x -= centroX;
  leftPos.y -= centroY;
  rightPos.x -= centroX;
  rightPos.y -= centroY;

  const ancho = maxX - minX;
  const alto = maxY - minY;
  return {
    items,
    leftPos,
    rightPos,
    w: ancho + 2 * margen,
    h: alto + 2 * margen,
    minX: -ancho / 2,
    minY: -alto / 2,
  };
}

/**
 * Escala de la vista: encajar sin pasarse de ESC_MAX y sin bajar de ESC_MIN.
 *
 * ESC_MIN es un suelo de LEGIBILIDAD, no un ajuste: cuando manda, el sobrante
 * cae en el eje vertical, que es el que tiene scroll.
 *
 * Con una excepción, y es la que hace que "nunca desborda a lo ancho" sea un
 * teorema y no una probabilidad: el suelo NO puede ganarle al ancho disponible.
 * elegirPerRow acota la caja de la cadena que espera, pero el ancho real de un
 * tablero depende de dónde caigan los dobles: como acortan su fila, las filas
 * dejan de medir lo mismo y el zigzag deriva hacia un lado. Medido sobre 3000
 * cadenas reales aleatorias, la caja llega a ser un 19 % más ancha de lo
 * previsto en doble-6 y un 45 % en doble-9. Cuando eso pasa se prefiere una
 * ficha por debajo del suelo antes que media mesa fuera de la pantalla.
 */
export function escalaDeVista(bbox, uW, uH, escMin, escMax) {
  const min = Number.isFinite(escMin) ? escMin : ESC_MIN_POR_DEFECTO;
  const max = Number.isFinite(escMax) ? escMax : ESC_MAX_POR_DEFECTO;
  if (!bbox || !(bbox.w > 0) || !(bbox.h > 0) || !(uW > 0) || !(uH > 0)) return min;
  const cabeDeAncho = uW / bbox.w;
  const ideal = Math.min(cabeDeAncho, uH / bbox.h);
  return Math.min(Math.max(min, Math.min(max, ideal)), cabeDeAncho);
}

/**
 * Elige cuántas fichas caben por fila. Se fija UNA VEZ por ronda.
 *
 * La restricción es dura y se evalúa contra el ancho REAL que devuelve
 * trazarSerpiente, nunca contra un ancho de fila nominal (`pr * 104 - 8`): la
 * caja real supera al nominal en decenas de píxeles porque las esquinas asoman
 * por el lado izquierdo de cada fila. Y se evalúa sobre la cadena SIN DOBLES,
 * que es el peor caso: si cupiera solo la cadena que toca hoy, un tablero real
 * con menos dobles desbordaría sin aviso.
 *
 * Para un perRow fijo la caja no decrece al añadir fichas, así que comprobar la
 * cadena entera cubre todos los tableros intermedios de ESA cadena. Lo que no
 * cubre es la deriva de las filas cuando los dobles caen repartidos; de eso se
 * ocupa escalaDeVista, y allí está explicada.
 */
export function elegirPerRow(totalMazo, maxPip, uW, uH, escMin, escMax, geometria) {
  if (!(uW > 0) || !(uH > 0)) return PER_ROW_INICIAL;

  const geom = geometria || GEOMETRIA_POR_DEFECTO;
  const fichas = Math.min(
    Math.max(1, Math.floor(totalMazo) || 0),
    longitudMaximaDeCadena(maxPip)
  );
  const cadena = cadenaMasAncha(fichas, maxPip);

  let mejor = null;
  for (let pr = PER_ROW_MIN; pr <= PER_ROW_MAX; pr++) {
    const trazo = trazarSerpiente(cadena, { ...geom, perRow: pr });
    if (trazo.w * escMin > uW) continue; // RESTRICCIÓN DURA
    const s = Math.min(uW / trazo.w, uH / trazo.h, escMax);
    const altoFinal = trazo.h * Math.max(escMin, s);
    // A igualdad de escala gana el que deje la mesa más corta: menos scroll.
    if (!mejor || s > mejor.s || (s === mejor.s && altoFinal < mejor.altoFinal)) {
      mejor = { pr, s, altoFinal };
    }
  }
  // Si no cabe ni la fila más corta, se devuelve la más corta igualmente: es un
  // contenedor tan estrecho que no hay respuesta buena, y 2 desborda lo mínimo.
  return mejor ? mejor.pr : PER_ROW_MIN;
}

/**
 * Franja vertical que la cámara tiene que dejar a la vista tras una jugada: los
 * dos extremos abiertos y la ficha recién colocada, ya en píxeles del lienzo
 * (o sea, con el margen sumado y la escala aplicada).
 *
 * Vive aquí y no en el componente porque es la misma aritmética de coordenadas
 * que coloca las fichas, y equivocarse de signo o saltarse el `- minY` manda la
 * mesa a un sitio que nadie está mirando.
 */
export function cajaDeLaJugada(trazo, escala, margen, ultima) {
  if (!trazo || !trazo.items || trazo.items.length === 0) return null;
  const enLienzo = (y) => (y - trazo.minY + margen) * escala;
  const ys = [];
  if (trazo.leftPos) ys.push(enLienzo(trazo.leftPos.y));
  if (trazo.rightPos) ys.push(enLienzo(trazo.rightPos.y));
  if (ultima) {
    ys.push(enLienzo(ultima.cy - ultima.h / 2));
    ys.push(enLienzo(ultima.cy + ultima.h / 2));
  }
  if (!ys.length) return null;
  return { arriba: Math.min(...ys), abajo: Math.max(...ys) };
}

/** Número de pips más alto del mazo a partir del total de fichas (28 -> 6). */
export function maxPipDelMazo(totalMazo) {
  const total = Math.max(1, Math.floor(totalMazo) || 0);
  // Inversa exacta de (p+1)(p+2)/2 para los totales válidos.
  return Math.max(0, Math.round((Math.sqrt(1 + 8 * total) - 3) / 2));
}
