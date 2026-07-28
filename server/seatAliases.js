// Alias de asiento: el id de CUENTA nunca sale de la sala.
//
// ─── El problema ───
// `getGameStateForPlayer` enviaba `id: p.id` —el id persistente de la cuenta— a
// rivales y espectadores. Cualquiera podía espectar una partida pública y
// cosechar identidades. Con el oráculo de tokens cerrado y la capa de sala
// vinculada eso ya no permite robar cuentas, pero sigue siendo divulgación de un
// identificador estable (rastreo entre partidas) y facilita la ventana de
// migración de la reclamación de identidades.
//
// ─── Por qué se traduce POR VALOR y no campo a campo ───
// El estado lleva ids en muchos sitios: `players[].id`, `currentPlayerId`,
// `hostId`, `gameWinner`, `roundWinner`, `lastPlacedBy`, los `...OwnerId` y
// `...TargetId` de los efectos, el `moveLog`… Enumerarlos a mano es una lista
// que se queda corta en cuanto alguien añade un campo: se filtra un id o, peor,
// se rompe una comparación de la interfaz en silencio.
//
// Aquí se recorre el estado ya construido y se sustituye CUALQUIER cadena que
// sea un id conocido de esa sala. Es exhaustivo por construcción: un campo
// nuevo queda cubierto sin tocar este fichero.
//
// El alias es estable durante toda la vida de la sala (las claves de React y las
// reconexiones dependen de ello) y no dice nada de la cuenta.

const crypto = require('crypto');

// roomId -> { porCuenta: Map<cuenta, alias>, porAlias: Map<alias, cuenta> }
const salas = new Map();

function tablaDe(roomId) {
  let t = salas.get(roomId);
  if (!t) {
    t = { porCuenta: new Map(), porAlias: new Map() };
    salas.set(roomId, t);
  }
  return t;
}

/** Alias de un id de cuenta en una sala. Lo crea la primera vez. */
function aliasDe(roomId, cuenta) {
  if (!cuenta || typeof cuenta !== 'string') return cuenta;
  const t = tablaDe(roomId);
  let alias = t.porCuenta.get(cuenta);
  if (!alias) {
    alias = 's_' + crypto.randomBytes(9).toString('base64url');
    t.porCuenta.set(cuenta, alias);
    t.porAlias.set(alias, cuenta);
  }
  return alias;
}

/**
 * Id de cuenta a partir de un alias. Si no es un alias conocido se devuelve tal
 * cual: los handlers reciben también valores que NO son jugadores ('left',
 * 'right', ids de bot…) y deben seguir funcionando.
 */
function cuentaDe(roomId, alias) {
  if (!alias || typeof alias !== 'string') return alias;
  const t = salas.get(roomId);
  if (!t) return alias;
  return t.porAlias.get(alias) || alias;
}

/** Traduce los campos indicados de un payload entrante: alias -> cuenta. */
function traducirEntrada(roomId, payload, campos) {
  if (!payload) return payload;
  const salida = { ...payload };
  for (const campo of campos) {
    if (typeof salida[campo] === 'string') salida[campo] = cuentaDe(roomId, salida[campo]);
  }
  return salida;
}

/**
 * Copia del estado con todos los ids de cuenta sustituidos por sus alias.
 *
 * Se recorren valores Y claves de objeto: si alguna vez el estado incluyera un
 * mapa indexado por jugador, también quedaría cubierto.
 */
function aliasarEstado(roomId, estado) {
  const t = salas.get(roomId);
  if (!t || !t.porCuenta.size) return estado;
  const mapa = t.porCuenta;

  const traducir = (valor) => {
    if (typeof valor === 'string') return mapa.get(valor) || valor;
    if (Array.isArray(valor)) return valor.map(traducir);
    if (valor && typeof valor === 'object') {
      const salida = {};
      for (const [k, v] of Object.entries(valor)) {
        salida[mapa.get(k) || k] = traducir(v);
      }
      return salida;
    }
    return valor;
  };

  return traducir(estado);
}

/** Registra de golpe a los jugadores de una sala (para que exista su alias). */
function registrarJugadores(roomId, jugadores) {
  for (const p of jugadores || []) if (p && p.id) aliasDe(roomId, p.id);
}

/** Al destruir la sala se tira su tabla: los alias no sobreviven a la partida. */
function olvidarSala(roomId) {
  salas.delete(roomId);
}

function _salasRegistradas() {
  return salas.size;
}

module.exports = {
  aliasDe,
  cuentaDe,
  traducirEntrada,
  aliasarEstado,
  registrarJugadores,
  olvidarSala,
  _salasRegistradas
};
