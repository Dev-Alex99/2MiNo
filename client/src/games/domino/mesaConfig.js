// Configuración de la mesa de dominó.
//
// La geometría del tablero vive en tokens CSS (base.css) y se lee desde ahí en
// vez de repetirla en JS: mesa.css redefine --mesa-esc-min y --mesa-pad-* por
// breakpoint, y una constante escrita en el módulo se quedaría con el valor de
// móvil en un escritorio sin que nadie lo note.

// Respaldo con los mismos valores que el :root de base.css. Hace falta porque
// getComputedStyle devuelve cadena vacía en dos situaciones reales: en jsdom,
// donde los tests no cargan ninguna hoja de estilo, y en el primer trazado, si
// el elemento aún no está en el documento.
const RESPALDO = {
  largo: 96,
  corto: 52,
  hueco: 8,
  margen: 8,
  escMin: 0.70,
  escMax: 1.35,
  padX: 12,
  padY: 8,
};

// parseFloat se traga la unidad ('96px' -> 96) y da NaN con la cadena vacía,
// que es justo el caso en el que hay que caer al respaldo.
function aNumero(valor, respaldo) {
  const n = parseFloat(valor);
  return Number.isFinite(n) ? n : respaldo;
}

/**
 * Lee la geometría vigente para el elemento dado (normalmente el contenedor de
 * la mesa, porque es quien hereda los valores del breakpoint activo).
 * Devuelve siempre números en píxeles lógicos, nunca cadenas con unidad.
 */
export function leerGeometria(el) {
  const estilo =
    el && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(el)
      : null;

  const leer = (token, respaldo) =>
    aNumero(estilo ? estilo.getPropertyValue(token) : '', respaldo);

  return {
    largo: leer('--ficha-largo', RESPALDO.largo),
    corto: leer('--ficha-corto', RESPALDO.corto),
    hueco: leer('--ficha-hueco', RESPALDO.hueco),
    margen: leer('--mesa-margen', RESPALDO.margen),
    escMin: leer('--mesa-esc-min', RESPALDO.escMin),
    escMax: leer('--mesa-esc-max', RESPALDO.escMax),
    padX: leer('--mesa-pad-x', RESPALDO.padX),
    padY: leer('--mesa-pad-y', RESPALDO.padY),
  };
}

// Medidor de nivel del bot en el chip de la cinta.
//
// Nació apagado porque los cuatro niveles jugaban igual —'dificil' ni siquiera
// aparecía en botLogic.js— y la insignia habría sido una mentira visible en
// cada partida. Se enciende ahora porque las dos condiciones que se pusieron
// entonces ya se cumplen: cada nivel tiene comportamiento propio (anular los
// pesos de una capacidad cambia decisiones medibles, testBotLevels.js) y la
// escalera está demostrada con victorias contadas y reproducible en cinco
// familias de semillas distintas (testBotStrength.js). Si alguien vuelve a
// dejar los niveles indistinguibles, esas dos suites se ponen rojas antes de
// que la insignia mienta.
export const MOSTRAR_NIVEL_BOT = true;
