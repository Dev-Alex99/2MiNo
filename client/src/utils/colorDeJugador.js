// Color de identidad de un jugador.
//
// Sustituye a getAvatarColor (WaitingRoom.jsx), que devolvía clases de Tailwind
// ('from-emerald-400 to-teal-600') en un proyecto que no usa Tailwind: los
// avatares llevaban desde siempre un fondo transparente. Aquí sale un token
// real de base.css.
//
// El reparto es determinista a propósito: la misma persona tiene que llevar el
// mismo color en la cinta de turno, en la sala de espera y en el anillo de la
// última ficha jugada, sin que nadie guarde ni sincronice esa asignación.

// --jugador-1 .. --jugador-4. Ninguno es verde, ámbar ni rojo: esos tres ya
// significan estado y confundirlos con identidad rompe la lectura de la mesa.
const TONOS = 4;

export function colorDeJugador(id) {
  const texto = String(id ?? '');
  // Hash clásico de cadena, el mismo que ya usaba getAvatarColor: barato,
  // estable entre navegadores y sin dependencias. El | 0 lo mantiene en 32 bits
  // para que el resultado no dependa de la precisión del acumulador.
  let hash = 0;
  for (let i = 0; i < texto.length; i++) {
    hash = (texto.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  }
  return `var(--jugador-${(Math.abs(hash) % TONOS) + 1})`;
}
