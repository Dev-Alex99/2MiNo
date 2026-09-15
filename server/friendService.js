// Utilidades de amigos compartidas por los handlers y el server (desconexión).
const presence = require('./presence');

/**
 * Actividad PÚBLICA de una cuenta. Se compone de tres fuentes porque ninguna
 * las sabe todas:
 *   · `presence` guarda lo que cada pestaña declaró y la disponibilidad;
 *   · `voicePools` sabe si está en una línea de voz AHORA;
 *   · la sala sabe si su partida ya arrancó, cosa que puede pasar sin que el
 *     jugador toque nada (el reloj de turno o un bot la empiezan), así que
 *     `en_sala` se refina aquí en el momento de emitir.
 * Prioridad: no_molestar > en_llamada > jugando > en_sala > libre.
 */
function actividadDe(playerId) {
  if (!playerId) return { estado: 'desconectado', roomId: null };
  if (presence.disponibilidadDe(playerId) === 'no_molestar') return { estado: 'no_molestar', roomId: null };
  if (!presence.isOnline(playerId)) return { estado: 'desconectado', roomId: null };

  try {
    if (require('./voicePools').estaEnLinea(playerId)) {
      const base = presence.actividadDe(playerId);
      return { estado: 'en_llamada', roomId: base.roomId };
    }
  } catch (e) { /* noop */ }

  const act = presence.actividadDe(playerId);
  if (act.estado === 'en_sala' && act.roomId) {
    try {
      const sala = require('./roomManager').rooms.get(act.roomId);
      if (sala && sala.status === 'playing') return { estado: 'jugando', roomId: act.roomId };
    } catch (e) { /* noop */ }
  }
  return act;
}

/** Lo que viaja en `friend_presence`. */
function estadoPublico(playerId) {
  return { id: playerId, online: presence.isOnline(playerId), actividad: actividadDe(playerId) };
}

// Envía la lista de amigos + solicitudes (con estado online) a todos los
// sockets de un jugador.
async function pushFriendsList(io, playerId) {
  const set = presence.socketsOf(playerId);
  if (!set || !set.size) return;
  const { getFriends, getFriendRequests } = require('./db');
  const friends = (await getFriends(playerId)).map(f => ({
    ...f,
    online: presence.isOnline(f.id),
    actividad: actividadDe(f.id)
  }));
  const requests = await getFriendRequests(playerId);
  const payload = { friends, requests };
  for (const sid of set) io.to(sid).emit('friends_data', payload);
}

/**
 * Avisa del cambio de presencia de UN jugador a quien deba enterarse.
 *
 * Antes esto reenviaba la lista de amigos ENTERA a cada amigo conectado:
 * 1 + 2N consultas SECUENCIALES por cada conexión y otras tantas por cada
 * desconexión, contra un pool de 5 conexiones, para cambiar un punto de color.
 * Ahora es UNA consulta y un evento diferencial por destinatario.
 *
 * La actividad detallada solo sale hacia amistades aceptadas (y hacia las
 * propias pestañas del jugador). Actividad minuciosa más un identificador
 * permanente es un rastreador, no una lista de amigos.
 */
async function notifyFriendsOfPresence(io, playerId) {
  if (!playerId) return;
  try {
    const { getFriends } = require('./db');
    const payload = estadoPublico(playerId);
    const friends = await getFriends(playerId);
    for (const f of friends) {
      const set = presence.socketsOf(f.id);
      if (!set) continue;
      for (const sid of set) io.to(sid).emit('friend_presence', payload);
    }
  } catch (e) {
    // La presencia es informativa: que falle no puede tumbar una partida ni
    // una llamada. Casi todos los llamadores la disparan sin esperarla, así que
    // sin este catch una consulta caída sería una promesa rechazada suelta.
    console.warn('[presencia] no se pudo avisar a los amigos:', e.message);
  }
}

/** Como la anterior, pero informando también a las pestañas del propio jugador. */
function difundirPresencia(io, playerId) {
  if (!playerId) return;
  const payload = estadoPublico(playerId);
  const propios = presence.socketsOf(playerId);
  if (propios) for (const sid of propios) io.to(sid).emit('friend_presence', payload);
  notifyFriendsOfPresence(io, playerId);
}

module.exports = { pushFriendsList, notifyFriendsOfPresence, difundirPresencia, actividadDe, estadoPublico };
