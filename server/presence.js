// Presencia online: mapea sockets ↔ id persistente de jugador para saber quién
// está conectado (lo usa el sistema de amigos y ahora también la voz). Un
// jugador puede tener varios sockets (varias pestañas); se considera online
// mientras le quede al menos uno.
//
// Módulo HOJA a propósito: no requiere nada del servidor. Todo lo que sabe se
// lo cuentan desde fuera, lo que permite probarlo entero sin levantar nada.

const socketToPlayer = new Map(); // socketId -> playerId
const playerSockets = new Map();  // playerId -> Set<socketId>

// Actividad POR SOCKET (una pestaña) y disponibilidad POR CUENTA.
// La actividad se guarda por socket a propósito: fijarla por «el último socket
// que habló» haría que dos pestañas del mismo jugador se pisaran (una en el
// hub y otra en partida se turnarían para decir cosas contrarias).
const actividades = new Map();      // socketId -> { estado, roomId }
const disponibilidades = new Map(); // playerId -> 'libre' | 'no_molestar'

// Nombre visible por cuenta. El servidor lo necesita para poner él mismo el
// `fromName` de una llamada entrante: antes viajaba en el payload de
// `call_friend` sin validar hasta un <h4> del cliente.
const nombres = new Map();          // playerId -> nombre

// De más urgente a menos. `no_molestar` gana a todo: es una decisión explícita
// del jugador y ninguna pestaña puede contradecirla.
const PRIORIDAD = ['no_molestar', 'en_llamada', 'jugando', 'en_sala', 'libre'];

// Devuelve { becameOnline } = true si es el PRIMER socket del jugador (pasó a online).
function register(socketId, playerId) {
  if (!socketId || !playerId) return { becameOnline: false };
  const prev = socketToPlayer.get(socketId);
  if (prev && prev !== playerId) unregister(socketId);
  socketToPlayer.set(socketId, playerId);
  let set = playerSockets.get(playerId);
  const wasOffline = !set || set.size === 0;
  if (!set) { set = new Set(); playerSockets.set(playerId, set); }
  set.add(socketId);
  return { becameOnline: wasOffline };
}

// Devuelve { becameOffline, playerId }; becameOffline = true si era su ÚLTIMO socket.
function unregister(socketId) {
  actividades.delete(socketId);
  const pid = socketToPlayer.get(socketId);
  if (!pid) return { becameOffline: false, playerId: null };
  socketToPlayer.delete(socketId);
  const set = playerSockets.get(pid);
  let becameOffline = false;
  if (set) {
    set.delete(socketId);
    if (set.size === 0) { playerSockets.delete(pid); becameOffline = true; }
  }
  // La disponibilidad NO se borra al desconectar: «no molestar» es una decisión
  // del jugador, no del estado de su conexión. Se borra al volver a `libre`.
  return { becameOffline, playerId: pid };
}

function isOnline(playerId) {
  const s = playerSockets.get(playerId);
  return !!(s && s.size > 0);
}

function socketsOf(playerId) {
  return playerSockets.get(playerId) || null;
}

function playerOf(socketId) {
  return socketToPlayer.get(socketId) || null;
}

// ─── Nombres ───

const avatares = new Map();         // playerId -> avatar

function recordarNombre(playerId, nombre) {
  if (!playerId) return;
  const limpio = String(nombre || '').trim().slice(0, 20);
  if (limpio) nombres.set(playerId, limpio);
}

function nombreDe(playerId) {
  return nombres.get(playerId) || 'Jugador';
}

function recordarAvatar(playerId, avatar) {
  if (!playerId) return;
  const limpio = String(avatar || '').trim().slice(0, 32);
  if (limpio) avatares.set(playerId, limpio);
}

function avatarDe(playerId) {
  return avatares.get(playerId) || '🎲';
}

// ─── Actividad y disponibilidad ───

/** Qué está haciendo ESTA pestaña. `estado` ∈ PRIORIDAD (sin no_molestar). */
function setActividad(socketId, { estado, roomId } = {}) {
  if (!socketId) return;
  const valido = PRIORIDAD.includes(estado) && estado !== 'no_molestar' ? estado : 'libre';
  actividades.set(socketId, { estado: valido, roomId: roomId || null });
}

function setDisponibilidad(playerId, modo) {
  if (!playerId) return;
  if (modo === 'no_molestar') disponibilidades.set(playerId, 'no_molestar');
  else disponibilidades.delete(playerId);
}

function disponibilidadDe(playerId) {
  return disponibilidades.get(playerId) || 'libre';
}

/**
 * Actividad AGREGADA de una cuenta sobre todas sus pestañas: gana la de mayor
 * prioridad. `no_molestar` la fija el propio jugador y se impone a todas.
 */
function actividadDe(playerId) {
  if (!playerId) return { estado: 'desconectado', roomId: null };
  if (disponibilidadDe(playerId) === 'no_molestar') return { estado: 'no_molestar', roomId: null };
  const set = playerSockets.get(playerId);
  if (!set || !set.size) return { estado: 'desconectado', roomId: null };

  let mejor = { estado: 'libre', roomId: null };
  let mejorRango = PRIORIDAD.indexOf('libre');
  for (const sid of set) {
    const act = actividades.get(sid);
    if (!act) continue;
    const rango = PRIORIDAD.indexOf(act.estado);
    if (rango >= 0 && rango < mejorRango) { mejor = act; mejorRango = rango; }
  }
  return { estado: mejor.estado, roomId: mejor.roomId || null };
}

/** Solo para pruebas. */
function _reset() {
  socketToPlayer.clear();
  playerSockets.clear();
  actividades.clear();
  disponibilidades.clear();
  nombres.clear();
  avatares.clear();
}

module.exports = {
  PRIORIDAD,
  register,
  unregister,
  isOnline,
  socketsOf,
  playerOf,
  recordarNombre,
  nombreDe,
  recordarAvatar,
  avatarDe,
  setActividad,
  setDisponibilidad,
  disponibilidadDe,
  actividadDe,
  _reset
};
