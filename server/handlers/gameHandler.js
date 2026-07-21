const {
  rooms,
  publicRoomsList,
  spectatableRoomsList,
  lobbyStats,
  addSpectator,
  removeSpectatorEverywhere,
  broadcastGameState,
  broadcastLobby,
  advanceRoom,
  scheduleEffectExpiry
} = require('../roomManager');

const {
  spectateRoomSchema,
  leaveSpectateSchema,
  playTileSchema,
  drawTileSchema,
  passTurnSchema,
  usePowerCardSchema,
  roomOnlySchema,
  sendQuickMessageSchema,
  validate
} = require('../schemas');

function registerGameHandlers(io, socket) {
  // Lobby Subscripción
  socket.on('lobby_subscribe', () => {
    socket.join('lobby');
    socket.emit('rooms_list', publicRoomsList());
    socket.emit('live_games', spectatableRoomsList());
    socket.emit('lobby_stats', lobbyStats());
  });

  socket.on('lobby_unsubscribe', () => socket.leave('lobby'));

  // Espectar partida
  socket.on('spectate_room', (data) => {
    const v = validate(spectateRoomSchema, data);
    if (!v.success) return socket.emit('error_msg', { key: v.errorKey });

    const { roomId } = v.data;
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error_msg', { key: 'srv.err.roomNotFound' });
    if (game.status !== 'playing') return socket.emit('error_msg', { key: 'srv.err.notWatchable' });

    socket.leave('lobby');
    socket.join(roomId);
    addSpectator(roomId, socket.id);

    socket.emit('spectating', { roomId });
    socket.emit('game_state', game.getSpectatorState());
    broadcastLobby(io);
  });

  // Dejar de espectar
  socket.on('leave_spectate', (data) => {
    const v = validate(leaveSpectateSchema, data);
    const roomId = v.success ? v.data.roomId : null;

    removeSpectatorEverywhere(socket.id);
    if (roomId) socket.leave(roomId);
    broadcastLobby(io);
  });

  // 4. Jugar una ficha
  socket.on('play_tile', (data) => {
    const v = validate(playTileSchema, data);
    if (!v.success) return;

    const { roomId, playerId, tileIndex, side } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.playTile(playerId, tileIndex, side);
    if (result.success) {
      const isDouble = game.lastPlay && game.lastPlay.tile && game.lastPlay.tile[0] === game.lastPlay.tile[1];
      io.to(roomId).emit('play_sound', { type: isDouble ? 'double_place' : 'place', tile: game.lastPlay.tile });
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    } else {
      socket.emit('error_msg', { key: result.error });
    }
  });

  // 5. Robar ficha
  socket.on('draw_tile', (data) => {
    const v = validate(drawTileSchema, data);
    if (!v.success) return;

    const { roomId, playerId } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.drawTile(playerId);
    if (result.success) {
      io.to(roomId).emit('play_sound', { type: 'draw' });
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    } else {
      socket.emit('error_msg', { key: result.error });
    }
  });

  // 6. Pasar turno
  socket.on('pass_turn', (data) => {
    const v = validate(passTurnSchema, data);
    if (!v.success) return;

    const { roomId, playerId } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.passTurn(playerId);
    if (result.success) {
      io.to(roomId).emit('play_sound', { type: 'pass' });
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    } else {
      socket.emit('error_msg', { key: result.error });
    }
  });

  // 6.5 Usar carta de poder
  socket.on('use_power_card', (data) => {
    const v = validate(usePowerCardSchema, data);
    if (!v.success) return;

    const { roomId, playerId, cardId, targetId, tileIndex } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;

    const player = game.players.find(p => p.id === playerId);
    if (!player) return;

    const result = game.usePowerCard(playerId, cardId, targetId, tileIndex);
    if (result.success) {
      io.to(roomId).emit('play_sound', { type: 'power' });

      const targetPlayer = targetId ? game.players.find(p => p.id === targetId) : null;
      const targetName = targetPlayer ? targetPlayer.name : '@opponent';
      let msgKey;
      const msgParams = { name: player.name };

      if (result.shielded) {
        msgKey = 'srv.pw.shielded';
        msgParams.target = result.targetName;
      } else {
        switch (cardId) {
          case 'double_shot': msgKey = 'srv.pw.double_shot'; break;
          case 'smuggle': msgKey = 'srv.pw.smuggle'; msgParams.target = targetName; break;
          case 'spy_eye': msgKey = 'srv.pw.spy_eye'; msgParams.target = targetName; break;
          case 'skip': msgKey = 'srv.pw.skip'; break;
          case 'draw_penalty': msgKey = 'srv.pw.draw_penalty'; msgParams.target = targetName; break;
          case 'reverse': msgKey = 'srv.pw.reverse'; break;
          case 'trade': msgKey = 'srv.pw.trade'; break;
          case 'shield': msgKey = 'srv.pw.shield'; break;
          case 'freeze': msgKey = targetId === 'left' ? 'srv.pw.freezeLeft' : 'srv.pw.freezeRight'; break;
          case 'destiny_steal': msgKey = 'srv.pw.destiny_steal'; msgParams.target = targetName; break;
          case 'mind_swap': msgKey = 'srv.pw.mind_swap'; msgParams.target = targetName; break;
          case 'tile_demolition': msgKey = targetId === 'left' ? 'srv.pw.demolishLeft' : 'srv.pw.demolishRight'; break;
          case 'wildcard': msgKey = 'srv.pw.wildcard'; break;
          case 'boneyard_reset': msgKey = 'srv.pw.boneyard_reset'; break;
          case 'magnetic_pull': msgKey = 'srv.pw.magnetic_pull'; msgParams.target = targetName; break;
          case 'russian_roulette': msgKey = 'srv.pw.russian_roulette'; break;
          case 'block_both': msgKey = 'srv.pw.block_both'; break;
          case 'storm': msgKey = 'srv.pw.storm'; break;
          case 'second_wind': msgKey = 'srv.pw.second_wind'; break;
          case 'spy_all': msgKey = 'srv.pw.spy_all'; break;
          case 'curse': msgKey = 'srv.pw.curse'; msgParams.target = targetName; break;
          default: msgKey = 'srv.pw.default';
        }
      }

      io.to(roomId).emit('receive_quick_message', {
        playerName: 'SISTEMA',
        key: msgKey,
        params: msgParams,
        type: 'phrase'
      });

      if (cardId === 'spy_eye' && game.activeEffects.spyEyeEndTime) {
        scheduleEffectExpiry(io, roomId, game.activeEffects.spyEyeEndTime - Date.now());
      }
      if (cardId === 'spy_all' && game.activeEffects.spyAllEndTime) {
        scheduleEffectExpiry(io, roomId, game.activeEffects.spyAllEndTime - Date.now());
      }

      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    } else {
      socket.emit('error_msg', { key: result.error });
    }
  });

  // 7. Siguiente ronda
  socket.on('next_round', (data) => {
    const v = validate(roomOnlySchema, data);
    if (!v.success) return;

    const { roomId } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;

    if (game.status === 'round_ended') {
      game.startNewRound();
      io.to(roomId).emit('play_sound', { type: 'shuffle' });
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    }
  });

  // 8. Reiniciar juego
  socket.on('play_again', (data) => {
    const v = validate(roomOnlySchema, data);
    if (!v.success) return;

    const { roomId } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;

    if (game.status === 'game_ended' || game.status === 'round_ended') {
      game.startNewGame();
      io.to(roomId).emit('play_sound', { type: 'shuffle' });
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    }
  });

  // 9. Mensajes rápidos
  socket.on('send_quick_message', (data) => {
    const v = validate(sendQuickMessageSchema, data);
    if (!v.success) return;

    const { roomId, playerId, text, type } = v.data;
    const game = rooms.get(roomId);
    if (!game) return;

    const player = game.players.find(p => p.id === playerId);
    if (!player) return;

    io.to(roomId).emit('receive_quick_message', {
      playerId,
      playerName: player.name,
      text,
      type
    });
  });

  // 10. Emoticonos animados sobre jugadores
  socket.on('send_emote', (data) => {
    if (!data || !data.roomId || !data.playerId || !data.emoji) return;
    const { roomId, playerId, emoji, targetPlayerId } = data;
    const game = rooms.get(roomId);
    if (!game) return;

    const sender = game.players.find(p => p.id === playerId);
    if (!sender) return;

    io.to(roomId).emit('player_emote', {
      senderId: playerId,
      senderName: sender.name,
      emoji,
      targetId: targetPlayerId || null
    });
  });
}

module.exports = registerGameHandlers;
