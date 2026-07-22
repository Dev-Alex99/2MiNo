// Presencia online: mapea sockets ↔ id persistente de jugador para saber quién
// está conectado (lo usa el sistema de amigos). Un jugador puede tener varios
// sockets (varias pestañas); se considera online mientras le quede al menos uno.

const socketToPlayer = new Map(); // socketId -> playerId
const playerSockets = new Map();  // playerId -> Set<socketId>

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
  const pid = socketToPlayer.get(socketId);
  if (!pid) return { becameOffline: false, playerId: null };
  socketToPlayer.delete(socketId);
  const set = playerSockets.get(pid);
  let becameOffline = false;
  if (set) { set.delete(socketId); if (set.size === 0) { playerSockets.delete(pid); becameOffline = true; } }
  return { becameOffline, playerId: pid };
}

function isOnline(playerId) {
  const s = playerSockets.get(playerId);
  return !!(s && s.size > 0);
}

function socketsOf(playerId) {
  return playerSockets.get(playerId) || null;
}

module.exports = { register, unregister, isOnline, socketsOf };
