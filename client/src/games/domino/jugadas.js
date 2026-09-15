// Regla de "qué puedo jugar", en un módulo propio.
//
// Vivía dentro de PlayerHand (getPlayableSides), así que el riel de extremos y
// el tablero no podían consultarla sin reescribirla: tres copias de la misma
// condición son tres sitios donde el comodín o el tablero vacío se olvidan por
// separado. La lógica no cambia respecto a la que había en el componente.

/**
 * Lados por los que una ficha encaja en el tablero actual.
 *
 * @param {number[]} tile  la ficha, [a, b]
 * @param {object} ctx  { isMyTurn, wildcardActive, boardIsEmpty, leftEnd, rightEnd }
 * @returns {{left: boolean, right: boolean}}
 */
export function ladosJugables(tile, ctx = {}) {
  const {
    isMyTurn,
    wildcardActive = false,
    boardIsEmpty = false,
    leftEnd = null,
    rightEnd = null
  } = ctx;

  const NINGUNO = { left: false, right: false };

  if (!isMyTurn) return NINGUNO;
  if (!Array.isArray(tile) || tile.length < 2) return NINGUNO;
  // Con el comodín activo la ficha entra por cualquier extremo, pero el derecho
  // solo existe si ya hay tablero: con la mesa vacía solo se abre por un sitio.
  if (wildcardActive) return { left: true, right: !boardIsEmpty };
  if (boardIsEmpty) return { left: true, right: true };

  const [a, b] = tile;
  return {
    left: a === leftEnd || b === leftEnd,
    right: a === rightEnd || b === rightEnd
  };
}

/**
 * Cuántas fichas de la mano encajan en algún extremo. Es el número que el riel
 * enseña como "N jugables"; el cliente ya lo calculaba para pintar el estado de
 * cada ficha, así que no cuesta nada.
 *
 * @param {number[][]} hand
 * @param {object} ctx  el mismo contexto de ladosJugables
 * @returns {number}
 */
export function contarJugables(hand, ctx = {}) {
  if (!Array.isArray(hand)) return 0;
  return hand.reduce((n, tile) => {
    const { left, right } = ladosJugables(tile, ctx);
    return n + (left || right ? 1 : 0);
  }, 0);
}
