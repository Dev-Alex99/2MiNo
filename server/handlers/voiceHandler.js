const { findMe, broadcastGameState } = require('../roomManager');
const { voiceCamSchema, voiceSignalSchema, voiceSpeakingSchema, validate } = require('../schemas');

function leaveVoice(io, socket, ctx) {
  if (!ctx || !ctx.player.inVoice) return;
  ctx.player.inVoice = false;
  ctx.player.camOn = false;
  socket.to(ctx.roomId).emit('voice_peer_left', { playerId: ctx.player.id });
  broadcastGameState(io, ctx.roomId);
}

function registerVoiceHandlers(io, socket) {
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

  socket.on('voice_signal', (data) => {
    const v = validate(voiceSignalSchema, data);
    if (!v.success) return;

    const ctx = findMe(socket.id);
    if (!ctx) return;

    const { to, data: signalData } = v.data;
    const target = ctx.game.players.find(p => p.id === to);
    if (!target || !target.socketId) return;

    io.to(target.socketId).emit('voice_signal', { from: ctx.player.id, data: signalData });
  });

  socket.on('voice_speaking', (data) => {
    const v = validate(voiceSpeakingSchema, data);
    const ctx = findMe(socket.id);
    if (!ctx || !ctx.player.inVoice) return;

    socket.to(ctx.roomId).emit('voice_speaking', { playerId: ctx.player.id, speaking: !!v.data.speaking });
  });

  return {
    leaveVoice: (ctx) => leaveVoice(io, socket, ctx)
  };
}

module.exports = { registerVoiceHandlers, leaveVoice };
