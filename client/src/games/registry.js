import DominoBoard from './domino/DominoBoard';
import DominoSpectatorBoard from './domino/DominoSpectatorBoard';
import TicTacToeBoard from './tictactoe/TicTacToeBoard';
import UnoBoard from './uno/UnoBoard';

/**
 * Registro de tableros del hub: id de juego → componente que lo pinta.
 *
 * Espejo en el cliente del `GameRegistry` del servidor. Existía ya un registro
 * aquí, pero nadie lo usaba y registraba el dominó SIN componente, así que
 * `GameView` resolvía el tablero con un `gameType === 'tictactoe' ? … : …`
 * incrustado: cada juego nuevo obligaba a añadir otra rama a ese condicional.
 *
 * Para añadir un juego: crear su tablero en `games/<id>/` y registrarlo aquí.
 * No hace falta tocar `GameView`.
 */
const TABLEROS = {
  domino: {
    id: 'domino',
    nombre: 'Dominó Online',
    icono: '🀁',
    componente: DominoBoard,
    espectador: DominoSpectatorBoard,
    // Capacidades: qué partes del lobby tienen sentido para este juego.
    // Sin esto el lobby ofrecía a TODOS los juegos las opciones del dominó
    // (variante doble 6/9, parejas, poderes, blitz) y los botones de
    // clasificatoria y torneo, que sólo el dominó implementa en el servidor.
    opcionesDeSala: true,
    clasificatoria: true,
    torneos: true
  },
  tictactoe: {
    id: 'tictactoe',
    nombre: 'Tres en Raya',
    icono: '❌',
    componente: TicTacToeBoard,
    // El propio tablero vale para espectar: sus casillas se deshabilitan solas
    // porque el turno nunca es del espectador.
    espectador: TicTacToeBoard,
    // No tiene variantes que configurar, y ni el emparejamiento por ELO ni los
    // torneos saben crear partidas suyas (ambos hacen `new DominoGame`).
    opcionesDeSala: false,
    clasificatoria: false,
    torneos: false
  },
  uno: {
    id: 'uno',
    nombre: 'Uno',
    icono: '🃏',
    componente: UnoBoard,
    // Vale el mismo tablero: el espectador nunca es el jugador de turno, así
    // que sus cartas salen deshabilitadas y su mano llega vacía del servidor.
    espectador: UnoBoard,
    // El panel de opciones del lobby es del dominó (variante, parejas, poderes),
    // así que no se ofrece: Uno juega a los 200 puntos por defecto. Ni cola por
    // ELO ni torneos, que en el servidor crean partidas de dominó.
    opcionesDeSala: false,
    clasificatoria: false,
    torneos: false
  }
};

const POR_DEFECTO = TABLEROS.domino;

/** Definición registrada, o null si ese juego no tiene tablero en el cliente. */
export function obtenerJuego(gameType) {
  return TABLEROS[gameType] || null;
}

/**
 * Componente de tablero para un tipo de juego.
 *
 * Cae a dominó cuando el tipo no está registrado: es el juego original y las
 * partidas antiguas llegan sin `gameType`. Antes ese caso también acababa en
 * dominó, sólo que por ser la rama `else` del condicional.
 */
export function obtenerTablero(gameType) {
  const juego = obtenerJuego(gameType);
  return juego ? juego.componente : POR_DEFECTO.componente;
}

/** Componente para VER una partida sin jugarla. Mismo criterio de respaldo. */
export function obtenerTableroEspectador(gameType) {
  const juego = obtenerJuego(gameType);
  return (juego && juego.espectador) || POR_DEFECTO.espectador;
}

/**
 * Ficha del juego con sus capacidades, siempre con valores utilizables aunque
 * el tipo no esté registrado (partidas antiguas sin `gameType`).
 */
export function capacidadesDe(gameType) {
  return obtenerJuego(gameType) || POR_DEFECTO;
}

export function listarJuegos() {
  return Object.values(TABLEROS);
}
