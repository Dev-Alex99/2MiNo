// Emparejamiento clasificatorio 1v1 por ELO. Los jugadores entran a una cola;
// se emparejan por ELO más cercano (con una pandilla pequeña, casar rápido es más
// importante que casar perfecto). La partida resultante es ranked (afecta al ELO).

const { getUserProfile } = require('./db');

const queue = []; // [{ playerId, name, socketId, elo, joinedAt }]

async function joinQueue(io, socket, player) {
  if (!player || !player.id) return;
  if (queue.some(q => q.playerId === player.id)) return; // ya en cola

  let elo = 1200;
  try {
    const prof = await getUserProfile(player.id);
    if (prof && prof.elo) elo = prof.elo;
  } catch { /* BD desactivada → ELO por defecto */ }

  // Re-comprobar tras el await (dos join_queue rápidos podrían haber pasado el
  // primer chequeo antes de resolverse la promesa).
  if (queue.some(q => q.playerId === player.id)) return;

  queue.push({ playerId: player.id, name: player.name, socketId: socket.id, elo, joinedAt: Date.now() });
  socket.emit('queue_joined', { size: queue.length });
  tryMatch(io);
}

function tryMatch(io) {
  while (queue.length >= 2) {
    // El que lleva más esperando marca la pareja; se le empareja con el ELO más
    // cercano (nunca consigo mismo si hubiera un duplicado en la cola).
    const a = queue.shift();
    let bestIdx = -1, bestGap = Infinity;
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].playerId === a.playerId) continue;
      const gap = Math.abs(queue[i].elo - a.elo);
      if (gap < bestGap) { bestGap = gap; bestIdx = i; }
    }
    if (bestIdx === -1) { queue.unshift(a); break; } // sin rival válido → esperar
    const b = queue.splice(bestIdx, 1)[0];
    createMatch(io, a, b);
  }
}

function createMatch(io, a, b) {
  const roomManager = require('./roomManager');
  const { roomId } = roomManager.createRankedMatch(io, [
    { id: a.playerId, name: a.name, socketId: a.socketId },
    { id: b.playerId, name: b.name, socketId: b.socketId }
  ]);
  for (const p of [a, b]) {
    io.to(p.socketId).emit('match_found', { roomId, playerId: p.playerId });
  }
  roomManager.advanceRoom(io, roomId);
  console.log(`[Matchmaking] ${a.name}(${a.elo}) vs ${b.name}(${b.elo}) → sala ${roomId}`);
}

function leaveQueue(socketId) {
  const i = queue.findIndex(q => q.socketId === socketId);
  if (i !== -1) queue.splice(i, 1);
}

function queueSize() { return queue.length; }

module.exports = { joinQueue, leaveQueue, tryMatch, queueSize, queue };
