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
  scheduleEffectExpiry,
  findMe,
  salaDeLobby,
  tiposDeJuego,
  salirDeLobbies
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
  sendEmoteSchema,
  validate
} = require('../schemas');

const seatAliases = require('../seatAliases');

// ¿El socket es dueño de ese playerId en la sala? Evita que otro socket
// manipule el turno/poderes/chat de un jugador ajeno.
function ownsPlayer(game, playerId, socketId) {
  const p = game.players.find(x => x.id === playerId);
  return !!p && p.socketId === socketId;
}

// El cliente sólo conoce ALIAS de asiento (el id de cuenta no sale de la sala),
// así que lo que llega hay que traducirlo de vuelta antes de tocar el motor.
// Los valores que no son un alias conocido —'left', 'right', ids de bot…— pasan
// tal cual.
function conIdsReales(roomId, datos, campos) {
  return seatAliases.traducirEntrada(roomId, datos, campos);
}

function registerGameHandlers(io, socket) {
  // Lobby Subscripción
  // Se entra al lobby DE UN JUEGO. Antes había uno solo y las listas iban sin
  // filtrar, así que desde el tres en raya se veían —y se podían abrir— salas
  // de dominó. 'lobby' a secas se conserva para las estadísticas globales.
  socket.on('lobby_subscribe', (data) => {
    const gameType = (data && typeof data.gameType === 'string') ? data.gameType : 'domino';
    // Salir de cualquier lobby anterior: cambiar de juego no debe dejarte
    // suscrito al listado del juego que acabas de abandonar.
    salirDeLobbies(socket);

    socket.join('lobby');
    socket.join(salaDeLobby(gameType));
    socket.emit('rooms_list', publicRoomsList(gameType));
    socket.emit('live_games', spectatableRoomsList(gameType));
    socket.emit('lobby_stats', lobbyStats());
  });

  socket.on('lobby_unsubscribe', () => salirDeLobbies(socket));

  // Espectar partida
  socket.on('spectate_room', (data) => {
    const v = validate(spectateRoomSchema, data);
    if (!v.success) return socket.emit('error_msg', { key: v.errorKey });

    const { roomId } = v.data;
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error_msg', { key: 'srv.err.roomNotFound' });
    if (game.status !== 'playing') return socket.emit('error_msg', { key: 'srv.err.notWatchable' });

    salirDeLobbies(socket);
    socket.join(roomId);
    addSpectator(roomId, socket.id);

    socket.emit('spectating', { roomId });
    seatAliases.registrarJugadores(roomId, game.players);
    socket.emit('game_state', seatAliases.aliasarEstado(roomId, game.getSpectatorState()));
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

    const { roomId, playerId, tileIndex, side } = conIdsReales(v.data.roomId, v.data, ['playerId']);
    const game = rooms.get(roomId);
    if (!game) return;
    if (!ownsPlayer(game, playerId, socket.id)) return;

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

    const { roomId, playerId } = conIdsReales(v.data.roomId, v.data, ['playerId']);
    const game = rooms.get(roomId);
    if (!game) return;
    if (!ownsPlayer(game, playerId, socket.id)) return;

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

    const { roomId, playerId } = conIdsReales(v.data.roomId, v.data, ['playerId']);
    const game = rooms.get(roomId);
    if (!game) return;
    if (!ownsPlayer(game, playerId, socket.id)) return;

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

    const { roomId, playerId, cardId, targetId, tileIndex } = conIdsReales(v.data.roomId, v.data, ['playerId', 'targetId']);
    const game = rooms.get(roomId);
    if (!game) return;

    const player = game.players.find(p => p.id === playerId);
    if (!player) return;
    if (player.socketId !== socket.id) return; // solo tu propio socket puede usar tus poderes

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

    const { roomId, playerId, text, type } = conIdsReales(v.data.roomId, v.data, ['playerId']);
    const game = rooms.get(roomId);
    if (!game) return;

    const player = game.players.find(p => p.id === playerId);
    if (!player || player.socketId !== socket.id) return; // no suplantar a otro jugador

    io.to(roomId).emit('receive_quick_message', {
      // De vuelta al cliente va el ALIAS: 'playerId' ya está traducido a id de
      // cuenta para el motor, y reemitirlo tal cual lo filtraría a la sala.
      playerId: seatAliases.aliasDe(roomId, playerId),
      playerName: player.name,
      text,
      type
    });
  });

  // 10. Emoticonos animados sobre jugadores
  socket.on('send_emote', (data) => {
    const v = validate(sendEmoteSchema, data);
    if (!v.success) return;
    const { roomId, playerId, emoji, targetPlayerId } = conIdsReales(v.data.roomId, v.data, ['playerId', 'targetPlayerId']);
    const game = rooms.get(roomId);
    if (!game) return;

    const sender = game.players.find(p => p.id === playerId);
    if (!sender || sender.socketId !== socket.id) return; // no suplantar el emisor

    io.to(roomId).emit('player_emote', {
      senderId: seatAliases.aliasDe(roomId, playerId),
      senderName: sender.name,
      emoji,
      targetId: targetPlayerId ? seatAliases.aliasDe(roomId, targetPlayerId) : null
    });
  });

  // --- MOTOR MULTIJUEGOS: ACCIONES GENÉRICAS (game_action & start_game) ---
  socket.on('game_action', (data) => {
    if (!data || !data.actionType) return;
    const ctx = findMe(socket.id);
    if (!ctx || !ctx.game) return;

    const { game, roomId, player } = ctx;
    const result = game.handleAction(player.id, data.actionType, data.payload || {});
    if (result.success) {
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    } else if (result.error) {
      socket.emit('error_msg', { key: result.error });
    }
  });

  socket.on('start_game', () => {
    const ctx = findMe(socket.id);
    if (!ctx || !ctx.game) return;

    const { game, roomId } = ctx;
    if (game.status === 'game_ended' || game.status === 'waiting') {
      game.startNewGame();
      advanceRoom(io, roomId);
      broadcastGameState(io, roomId);
    }
  });
}

module.exports = registerGameHandlers;
