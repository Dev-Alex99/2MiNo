// Utilidades de amigos compartidas por los handlers y el server (desconexión).
const presence = require('./presence');

// Envía la lista de amigos + solicitudes (con estado online) a todos los
// sockets de un jugador.
async function pushFriendsList(io, playerId) {
  const set = presence.socketsOf(playerId);
  if (!set || !set.size) return;
  const { getFriends, getFriendRequests } = require('./db');
  const friends = (await getFriends(playerId)).map(f => ({ ...f, online: presence.isOnline(f.id) }));
  const requests = await getFriendRequests(playerId);
  const payload = { friends, requests };
  for (const sid of set) io.to(sid).emit('friends_data', payload);
}

// Cuando un jugador se conecta/desconecta, refresca la lista de sus amigos que
// estén online para que su punto de presencia se actualice al instante.
async function notifyFriendsOfPresence(io, playerId) {
  if (!playerId) return;
  const { getFriends } = require('./db');
  const friends = await getFriends(playerId);
  for (const f of friends) {
    if (presence.isOnline(f.id)) await pushFriendsList(io, f.id);
  }
}

module.exports = { pushFriendsList, notifyFriendsOfPresence };
