import { listarJuegos } from '../games/registry';

/**
 * El catálogo del hub, compuesto sobre el registro de tableros.
 *
 * Antes esto estaba escrito DOS veces: `useHubStore.availableGames` (cinco
 * entradas con `subtitle` que no leía nadie y `color` guardando clases de
 * Tailwind en un proyecto sin Tailwind) y `games/registry.js` (tres entradas,
 * con `listarJuegos()` exportada y jamás llamada). Añadir un juego obligaba a
 * tocar los dos y a acordarse de que el nombre y el icono estaban duplicados.
 *
 * Ahora el registro manda: si un juego tiene tablero, sale en la rejilla. Aquí
 * sólo se añade lo que el registro no puede saber (qué anunciar de él) y la
 * lista de los que todavía no existen.
 *
 * REGLA DURA (CONTRATO §10): el `name` del juego NO pasa por `t()`. Es un
 * nombre propio, y `flujos.test.jsx` hace `getByText('Tres en Raya')` /
 * `getByText('Dominó Online')` siete veces. Lo que se traduce es la línea de
 * capacidades, que se compone con claves.
 */

/**
 * Juegos anunciados que aún no tienen tablero.
 *
 * Vivían en la rejilla como tarjetas con candado y `cursor: not-allowed` (sin
 * `aria-disabled`), ocupando 2 de 5 posiciones. En 375 px una tarjeta
 * deshabilitada es una promesa que cuesta una ranura entera, así que bajan a
 * una línea de pie: «Ludo Star y Ajedrez Blitz, en camino».
 */
export const PROXIMAMENTE = ['Ludo Star', 'Ajedrez Blitz'];

/**
 * Las claves i18n de la línea de capacidades de un juego, en orden de lectura.
 *
 * Sale entera del registro: el aforo, las parejas, los poderes, los torneos y
 * la clasificatoria son propiedades que el lobby ya consulta para decidir qué
 * ofrecer, así que la tarjeta no puede prometer algo que el lobby luego niega.
 * `hub.capJugadores` recibe el rango ya formateado ('2-4', o '2' cuando el
 * aforo es fijo, que es el caso del tres en raya).
 */
export function capacidadesDeJuego(juego) {
  const { min, max } = juego.jugadores || { min: 2, max: 4 };
  const rango = min === max ? String(min) : `${min}-${max}`;
  const claves = [{ clave: 'hub.capJugadores', params: { rango } }];
  if (juego.parejas) claves.push({ clave: 'hub.capParejas' });
  if (juego.poderes) claves.push({ clave: 'hub.capPoderes' });
  if (juego.torneos) claves.push({ clave: 'hub.capTorneos' });
  if (juego.clasificatoria) claves.push({ clave: 'hub.capClasificatoria' });
  return claves;
}

/** Las tarjetas de la rejilla, en el orden del registro. */
export function listarCatalogo() {
  return listarJuegos().map((juego) => ({
    id: juego.id,
    // Nombre propio: viaja tal cual, sin t().
    nombre: juego.nombre,
    icono: juego.icono,
    capacidades: capacidadesDeJuego(juego)
  }));
}
