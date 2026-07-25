const { findMe, broadcastGameState } = require('../roomManager');
const { voiceCamSchema, validate } = require('../schemas');
const { socketsOf } = require('../presence');

// Almacén de Salas/Pools de Voz de Grupo (Decoupled Voice Pools)
// poolId -> Map<playerId, { playerId, name, socketId }>
const voicePools = new Map();

// Registro de llamadas salientes timbrando
// callId -> { callId, poolId, callerId, callerName, callerSocketId, targetId, status: 'ringing' }
const activeCalls = new Map();

function broadcastPoolMembers(io, poolId) {
  const pool = voicePools.get(poolId);
  if (!pool) return;
  const members = Array.from(pool.values()).map(m => ({ playerId: m.playerId, name: m.name }));
  for (const member of pool.values()) {
    io.to(member.socketId).emit('voice_pool_updated', { poolId, members });
  }
}

function leaveVoice(io, socket, ctx) {
  if (!ctx || !ctx.player.inVoice) return;
  ctx.player.inVoice = false;
  ctx.player.camOn = false;
  socket.to(ctx.roomId).emit('voice_peer_left', { playerId: ctx.player.id });
  broadcastGameState(io, ctx.roomId);
}

function registerVoiceHandlers(io, socket) {
  // --- GRUPOS Y LLAMADAS DE VOZ MULTIJUGADOR (GLOBAL VOICE POOL) ---

  // 1. Iniciar llamada a un amigo (Crea o reutiliza una pool)
  socket.on('call_friend', ({ targetPlayerId, callerName, callerId }) => {
    const targetSockets = socketsOf(targetPlayerId);
    if (!targetSockets || targetSockets.size === 0) {
      return socket.emit('call_error', { message: 'El amigo no está en línea' });
    }

    // Buscar si el emisor ya está en una pool activa
    let poolId = null;
    for (const [pId, pool] of voicePools.entries()) {
      if (pool.has(callerId)) {
        poolId = pId;
        break;
      }
    }

    if (!poolId) {
      poolId = `vpool_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newPool = new Map();
      newPool.set(callerId, { playerId: callerId, name: callerName || 'Jugador', socketId: socket.id });
      voicePools.set(poolId, newPool);
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    activeCalls.set(callId, {
      callId,
      poolId,
      callerId,
      callerName: callerName || 'Jugador',
      callerSocketId: socket.id,
      targetId: targetPlayerId,
      status: 'ringing'
    });

    // Notificar timbrado entrante al amigo
    for (const sid of targetSockets) {
      io.to(sid).emit('incoming_call', {
        callId,
        poolId,
        fromPlayerId: callerId,
        fromName: callerName || 'Jugador'
      });
    }

    socket.emit('call_outgoing', { callId, poolId, targetPlayerId });

    // Cancelar timbrado tras 30s si nadie responde
    setTimeout(() => {
      const call = activeCalls.get(callId);
      if (call && call.status === 'ringing') {
        activeCalls.delete(callId);
        socket.emit('call_timeout', { callId });
        for (const sid of targetSockets) {
          io.to(sid).emit('call_cancelled', { callId });
        }
      }
    }, 30000);
  });

  // 2. Invitar a otro amigo a la llamada en curso (Grupo / Pool)
  socket.on('invite_to_pool', ({ poolId, targetPlayerId, inviterName, inviterId }) => {
    const targetSockets = socketsOf(targetPlayerId);
    if (!targetSockets || targetSockets.size === 0) {
      return socket.emit('call_error', { message: 'El usuario no está en línea' });
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    activeCalls.set(callId, {
      callId,
      poolId,
      callerId: inviterId,
      callerName: inviterName || 'Amigo',
      callerSocketId: socket.id,
      targetId: targetPlayerId,
      status: 'ringing'
    });

    for (const sid of targetSockets) {
      io.to(sid).emit('incoming_call', {
        callId,
        poolId,
        fromPlayerId: inviterId,
        fromName: inviterName || 'Amigo',
        isGroupInvite: true
      });
    }
  });

  // 3. Aceptar llamada / Unirse a la pool de voz
  socket.on('accept_call', ({ callId, poolId, playerId, name }) => {
    const call = activeCalls.get(callId);
    const targetPoolId = poolId || (call ? call.poolId : null);
    if (!targetPoolId) {
      return socket.emit('call_error', { message: 'La llamada o grupo ya no existe' });
    }

    if (call) {
      activeCalls.delete(callId);
      const callerSockets = socketsOf(call.callerId);
      if (callerSockets) {
        for (const sid of callerSockets) {
          io.to(sid).emit('call_accepted', { callId, poolId: targetPoolId });
        }
      }
    }

    let pool = voicePools.get(targetPoolId);
    if (!pool) {
      pool = new Map();
      voicePools.set(targetPoolId, pool);
    }

    pool.set(playerId, { playerId, name: name || 'Jugador', socketId: socket.id });

    socket.emit('voice_pool_joined', {
      poolId: targetPoolId,
      members: Array.from(pool.values()).map(m => ({ playerId: m.playerId, name: m.name }))
    });

    broadcastPoolMembers(io, targetPoolId);
  });

  // 4. Rechazar llamada
  socket.on('decline_call', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (call) {
      activeCalls.delete(callId);
      const targetSockets = socketsOf(call.callerId);
      if (targetSockets) {
        for (const sid of targetSockets) {
          io.to(sid).emit('call_declined', { callId });
        }
      }
    }
  });

  // 5. Señalización WebRTC para la Pool de Voz (Directa entre Peers de la Pool)
  socket.on('voice_pool_signal', ({ poolId, toPlayerId, signal }) => {
    const pool = voicePools.get(poolId);
    if (!pool) return;

    let fromPlayerId = null;
    for (const [pId, member] of pool.entries()) {
      if (member.socketId === socket.id) {
        fromPlayerId = pId;
        break;
      }
    }

    const targetMember = pool.get(toPlayerId);
    if (targetMember && fromPlayerId) {
      io.to(targetMember.socketId).emit('voice_pool_signal', {
        poolId,
        fromPlayerId,
        signal
      });
    }
  });

  // 6. Indicador de voz activa en pool
  socket.on('voice_pool_speaking', ({ poolId, speaking }) => {
    const pool = voicePools.get(poolId);
    if (!pool) return;
    for (const member of pool.values()) {
      if (member.socketId !== socket.id) {
        io.to(member.socketId).emit('voice_pool_speaking', { socketId: socket.id, speaking });
      }
    }
  });

  // 7. Salir / Colgar de la Pool de Voz
  socket.on('end_call', ({ poolId, playerId }) => {
    if (!poolId) return;
    const pool = voicePools.get(poolId);
    if (pool) {
      pool.delete(playerId);
      if (pool.size === 0) {
        voicePools.delete(poolId);
      } else {
        broadcastPoolMembers(io, poolId);
      }
    }
    socket.emit('voice_pool_left', { poolId });
  });

  // Limpieza al desconectar el socket
  socket.on('disconnect', () => {
    // 1. Limpieza de llamadas pendientes timbrando
    for (const [callId, call] of activeCalls.entries()) {
      if (call.callerSocketId === socket.id) {
        activeCalls.delete(callId);
        const targetSockets = socketsOf(call.targetId);
        if (targetSockets) {
          for (const sid of targetSockets) {
            io.to(sid).emit('call_cancelled', { callId });
          }
        }
      }
    }

    // 2. Limpieza de salas/pools de voz
    for (const [poolId, pool] of voicePools.entries()) {
      let removedPlayerId = null;
      for (const [pId, member] of pool.entries()) {
        if (member.socketId === socket.id) {
          removedPlayerId = pId;
          break;
        }
      }
      if (removedPlayerId) {
        pool.delete(removedPlayerId);
        if (pool.size === 0) {
          voicePools.delete(poolId);
        } else {
          broadcastPoolMembers(io, poolId);
        }
      }
    }
  });

  // --- SEÑALIZACIÓN WEBRTC Y PARTIDAS DE JUEGO (MESA) ---

  socket.on('voice_cam', (data) => {
    const v = validate(voiceCamSchema, data);
    const ctx = findMe(socket.id);
    if (!ctx || !ctx.player.inVoice) return;

    ctx.player.camOn = !!v.data.on;
    broadcastGameState(io, ctx.roomId);
  });

  socket.on('voice_join', () => {
    const ctx = findMe(socket.id);
    if (!ctx) return socket.emit('error_msg', { key: 'srv.err.notInRoom' });

    ctx.player.inVoice = true;
    ctx.player.camOn = false;

    const peers = ctx.game.players
      .filter(p => p.inVoice && p.socketId && p.id !== ctx.player.id)
      .map(p => ({ playerId: p.id, name: p.name }));

    socket.emit('voice_peers', { peers });
    socket.to(ctx.roomId).emit('voice_peer_joined', { playerId: ctx.player.id, name: ctx.player.name });
    broadcastGameState(io, ctx.roomId);
  });

  socket.on('voice_leave', () => {
    leaveVoice(io, socket, findMe(socket.id));
  });

  socket.on('voice_speaking', (data) => {
    const ctx = findMe(socket.id);
    if (!ctx || !ctx.player.inVoice) return;
    socket.to(ctx.roomId).emit('voice_speaking', { playerId: ctx.player.id, speaking: !!data.speaking });
  });

  return {
    leaveVoice: (ctx) => leaveVoice(io, socket, ctx)
  };
}

module.exports = { registerVoiceHandlers, leaveVoice };
