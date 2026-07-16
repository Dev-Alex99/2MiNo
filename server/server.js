const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const DominoGame = require('./gameLogic');
const { chooseMove, choosePower, pickBotName } = require('./botLogic');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // En un entorno real se limitaría a los dominios del frontend
    methods: ['GET', 'POST']
  }
});

// Almacén de salas activas: roomId -> DominoGame
const rooms = new Map();

// Temporizadores por sala: roomId -> handle
const turnTimers = new Map();   // reloj de turno
const effectTimers = new Map(); // caducidad de efectos (p. ej. Ojo Soplón)
const botTimers = new Map();    // "pensar" de los bots antes de jugar

// Segundos por turno. Configurable para ajustarlo sin tocar código.
const TURN_SECONDS = Math.max(5, Number(process.env.TURN_SECONDS) || 30);

// Genera un código de sala de 4 letras aleatorias
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  do {
    result = '';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(result));
  return result;
}

// Envía el estado del juego actualizado a todos los jugadores de la sala de forma privada
function broadcastGameState(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;

  game.players.forEach(player => {
    if (player.socketId) {
      io.to(player.socketId).emit('game_state', game.getGameStateForPlayer(player.id));
    }
  });
}

function clearRoomTimers(roomId) {
  clearTimeout(turnTimers.get(roomId));
  clearTimeout(effectTimers.get(roomId));
  clearTimeout(botTimers.get(roomId));
  turnTimers.delete(roomId);
  effectTimers.delete(roomId);
  botTimers.delete(roomId);
}

// Arranca (o reinicia) el reloj del turno actual. Sin esto, un jugador que se
// desconecta o se distrae deja la mesa colgada indefinidamente.
function armTurnTimer(roomId) {
  const game = rooms.get(roomId);
  clearTimeout(turnTimers.get(roomId));
  turnTimers.delete(roomId);

  if (!game || game.status !== 'playing') {
    if (game) game.turnEndsAt = null;
    return;
  }

  game.turnEndsAt = Date.now() + game.turnDurationMs;

  turnTimers.set(roomId, setTimeout(() => {
    const current = rooms.get(roomId);
    if (!current || current.status !== 'playing') return;

    const result = current.forceTurn();
    if (result.action === 'none') return;

    const detail = result.drew > 0 ? ` (robó ${result.drew})` : '';
    const text = result.action === 'played'
      ? `⏱️ A ${result.playerName} se le acabó el tiempo: jugó automáticamente${detail}.`
      : `⏱️ A ${result.playerName} se le acabó el tiempo: pasó turno${detail}.`;

    io.to(roomId).emit('receive_quick_message', { playerName: 'SISTEMA', text, type: 'phrase' });
    io.to(roomId).emit('play_sound', { type: result.action === 'played' ? 'place' : 'pass' });

    advanceRoom(roomId);
    broadcastGameState(roomId);
  }, game.turnDurationMs));
}

// Reemite el estado cuando un efecto temporal caduca. El Ojo Soplón se calcula
// con Date.now() al pedir el estado, así que sin esto la mano revelada seguía
// en pantalla hasta que alguien moviera.
function scheduleEffectExpiry(roomId, ms) {
  clearTimeout(effectTimers.get(roomId));
  effectTimers.set(roomId, setTimeout(() => {
    effectTimers.delete(roomId);
    if (rooms.has(roomId)) broadcastGameState(roomId);
  }, ms + 250));
}

// Si el turno es de un bot, lo juega tras una pausa para que se lea como una
// decisión y no como un cálculo instantáneo.
function scheduleBotTurn(roomId) {
  const game = rooms.get(roomId);
  clearTimeout(botTimers.get(roomId));
  botTimers.delete(roomId);

  if (!game || game.status !== 'playing') return;

  const current = game.players[game.currentPlayerIndex];
  if (!current || !current.isBot) return;

  const thinkMs = 700 + Math.floor(Math.random() * 900);

  botTimers.set(roomId, setTimeout(() => {
    botTimers.delete(roomId);
    const g = rooms.get(roomId);
    if (!g || g.status !== 'playing') return;

    const bot = g.players[g.currentPlayerIndex];
    if (!bot || !bot.isBot) return;

    // 1. Un poder sin objetivo, de vez en cuando.
    const powerId = choosePower(g, bot.id);
    if (powerId) {
      const used = g.usePowerCard(bot.id, powerId, null, null);
      if (used.success) {
        io.to(roomId).emit('play_sound', { type: 'power' });
        io.to(roomId).emit('receive_quick_message', {
          playerName: 'SISTEMA',
          text: `🤖 ${bot.name} usó una carta de poder.`,
          type: 'phrase'
        });
      }
    }

    // 2. Su jugada. forceTurn() ya implementa "juega / roba / pasa" con las
    //    reglas completas; solo elegimos nosotros QUÉ ficha, según dificultad.
    const move = chooseMove(g, bot.id);
    if (move) {
      const played = g.playTile(bot.id, move.tileIndex, move.side);
      if (played.success) {
        io.to(roomId).emit('play_sound', { type: 'place', tile: g.lastPlay.tile });
      } else {
        g.forceTurn();
      }
    } else {
      const result = g.forceTurn();
      io.to(roomId).emit('play_sound', { type: result.action === 'played' ? 'place' : 'pass' });
    }

    advanceRoom(roomId);
    broadcastGameState(roomId);
  }, thinkMs));
}

// Todo lo que hay que rearmar tras cambiar el estado de una partida.
function advanceRoom(roomId) {
  armTurnTimer(roomId);
  scheduleBotTurn(roomId);
}

io.on('connection', (socket) => {
  console.log(`Nuevo cliente conectado: ${socket.id}`);

  // 1. Crear una sala
  socket.on('create_room', ({ name, playerId, powersEnabled, maxPip }) => {
    if (!name) return socket.emit('error_msg', 'Nombre requerido');

    // No confiamos en el cliente: normalizamos las opciones aquí.
    const safeMaxPip = maxPip === 9 ? 9 : 6;
    const safePowers = powersEnabled !== false;

    const roomId = generateRoomId();
    const game = new DominoGame(roomId, null, {
      powersEnabled: safePowers,
      maxPip: safeMaxPip
    });
    game.turnDurationMs = TURN_SECONDS * 1000;

    const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
    game.addPlayer(actualPlayerId, name, socket.id);

    rooms.set(roomId, game);
    socket.join(roomId);

    socket.emit('room_created', { roomId, playerId: actualPlayerId });
    broadcastGameState(roomId);
    console.log(`Sala creada: ${roomId} por ${name} (doble ${safeMaxPip}, poderes: ${safePowers ? 'sí' : 'no'})`);
  });

  // 2. Unirse a una sala (soporta reconexión si se pasa el playerId existente)
  socket.on('join_room', ({ roomId, name, playerId }) => {
    roomId = roomId.trim().toUpperCase();
    const game = rooms.get(roomId);
    
    if (!game) {
      return socket.emit('error_msg', 'La sala no existe');
    }

    const actualPlayerId = playerId || `p_${Math.random().toString(36).substring(2, 9)}`;
    const existingPlayer = game.players.find(p => p.id === actualPlayerId);

    if (existingPlayer) {
      // Reconexión exitosa
      existingPlayer.socketId = socket.id;
      socket.join(roomId);
      socket.emit('room_joined', { roomId, playerId: actualPlayerId });
      broadcastGameState(roomId);
      console.log(`Jugador reconectado: ${existingPlayer.name} a sala ${roomId}`);
      return;
    }

    // Si es un nuevo jugador
    if (game.players.length >= 4) {
      return socket.emit('error_msg', 'La sala está llena (máximo 4 jugadores)');
    }
    if (game.status !== 'waiting') {
      return socket.emit('error_msg', 'La partida ya ha comenzado');
    }
    if (!name) {
      return socket.emit('error_msg', 'Nombre requerido');
    }

    game.addPlayer(actualPlayerId, name, socket.id);
    socket.join(roomId);
    
    socket.emit('room_joined', { roomId, playerId: actualPlayerId });
    broadcastGameState(roomId);
    console.log(`Jugador ${name} se unió a sala ${roomId}`);
  });

  // 2.5 Añadir / quitar bots (solo en la sala de espera)
  socket.on('add_bot', ({ roomId, difficulty }) => {
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error_msg', 'La sala no existe');
    if (game.status !== 'waiting') return socket.emit('error_msg', 'No se pueden añadir bots con la partida en curso');
    if (game.players.length >= 4) return socket.emit('error_msg', 'La sala está llena (máximo 4 jugadores)');

    const bot = game.addBot(pickBotName(game.players.map(p => p.name)), difficulty);
    if (!bot) return socket.emit('error_msg', 'No se pudo añadir el bot');

    broadcastGameState(roomId);
    console.log(`Bot ${bot.name} (${bot.difficulty}) añadido a sala ${roomId}`);

    // Un bot entra ya listo: puede completar el "todos listos".
    if (game.allReady()) {
      game.startNewGame();
      io.to(roomId).emit('game_started');
      advanceRoom(roomId);
      broadcastGameState(roomId);
    }
  });

  socket.on('remove_bot', ({ roomId, botId }) => {
    const game = rooms.get(roomId);
    if (!game) return;
    if (game.status !== 'waiting') return socket.emit('error_msg', 'No se pueden quitar bots con la partida en curso');

    const target = game.players.find(p => p.id === botId);
    if (!target || !target.isBot) return socket.emit('error_msg', 'Ese jugador no es un bot');

    game.removePlayerById(botId);
    broadcastGameState(roomId);
  });

  // 3. Cambiar estado de "Listo"
  socket.on('toggle_ready', ({ roomId, playerId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    game.toggleReady(socket.id);
    broadcastGameState(roomId);

    // Si todos están listos, iniciar la partida automáticamente
    if (game.allReady()) {
      game.startNewGame();
      io.to(roomId).emit('game_started');
      advanceRoom(roomId);
      broadcastGameState(roomId);
      console.log(`Partida iniciada en sala ${roomId}`);
    }
  });

  // 4. Jugar una ficha
  socket.on('play_tile', ({ roomId, playerId, tileIndex, side }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.playTile(playerId, tileIndex, side);
    if (result.success) {
      // Notificar sonido de ficha colocada
      io.to(roomId).emit('play_sound', { type: 'place', tile: game.lastPlay.tile });
      advanceRoom(roomId);
      broadcastGameState(roomId);
    } else {
      socket.emit('error_msg', result.error);
    }
  });

  // 5. Robar una ficha del pozo
  socket.on('draw_tile', ({ roomId, playerId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.drawTile(playerId);
    if (result.success) {
      io.to(roomId).emit('play_sound', { type: 'draw' });
      advanceRoom(roomId); // robar no cede el turno: se da margen nuevo
      broadcastGameState(roomId);
    } else {
      socket.emit('error_msg', result.error);
    }
  });

  // 6. Pasar turno
  socket.on('pass_turn', ({ roomId, playerId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.passTurn(playerId);
    if (result.success) {
      io.to(roomId).emit('play_sound', { type: 'pass' });
      advanceRoom(roomId);
      broadcastGameState(roomId);
    } else {
      socket.emit('error_msg', result.error);
    }
  });

  // 6.5 Usar una carta de poder
  socket.on('use_power_card', ({ roomId, playerId, cardId, targetId, tileIndex }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const player = game.players.find(p => p.id === playerId);
    if (!player) return;

    const result = game.usePowerCard(playerId, cardId, targetId, tileIndex);
    if (result.success) {
      // Emitir sonido de poder activado a toda la sala
      io.to(roomId).emit('play_sound', { type: 'power' });

      // Preparar notificaciones de chat según el poder
      let messageText = '';
      const targetPlayer = targetId ? game.players.find(p => p.id === targetId) : null;

      if (result.shielded) {
        messageText = `¡${player.name} intentó lanzar un poder contra ${result.targetName}, pero fue bloqueado por su Escudo de Neón!`;
      } else {
        switch (cardId) {
          case 'double_shot':
            messageText = `¡${player.name} usó Doble Tiro! Jugará dos veces seguidas.`;
            break;
          case 'smuggle':
            messageText = `¡${player.name} le regaló una ficha a ${targetPlayer ? targetPlayer.name : 'un oponente'} mediante Contrabando!`;
            break;
          case 'spy_eye':
            messageText = `¡${player.name} usó El Ojo Soplón para espiar las fichas de ${targetPlayer ? targetPlayer.name : 'un oponente'}!`;
            break;
          case 'skip':
            messageText = `¡${player.name} usó Salto de Turno! Se saltó al siguiente jugador.`;
            break;
          case 'draw_penalty':
            messageText = `¡${player.name} penalizó a ${targetPlayer ? targetPlayer.name : 'un oponente'} obligándolo a robar del pozo!`;
            break;
          case 'reverse':
            messageText = `¡${player.name} invirtió el sentido del juego!`;
            break;
          case 'trade':
            messageText = `¡${player.name} cambió una ficha de su mano por una del pozo!`;
            break;
          case 'shield':
            messageText = `¡${player.name} activó su Escudo de Neón y es inmune a ataques!`;
            break;
          case 'freeze':
            const frozenSide = targetId === 'left' ? 'izquierdo' : 'derecho';
            messageText = `¡${player.name} congeló el extremo ${frozenSide} del tablero! Nadie más puede jugar ahí este turno.`;
            break;
          case 'destiny_steal':
            messageText = `¡${player.name} le robó una carta de poder a ${targetPlayer ? targetPlayer.name : 'un oponente'}!`;
            break;
          case 'mind_swap':
            messageText = `¡${player.name} usó Intercambio Mental e intercambió su mano completa con ${targetPlayer ? targetPlayer.name : 'un oponente'}!`;
            break;
          case 'tile_demolition':
            const demolishedSide = targetId === 'left' ? 'izquierdo' : 'derecho';
            messageText = `¡${player.name} usó Ficha Dinamita y destruyó la ficha del extremo ${demolishedSide}!`;
            break;
          case 'wildcard':
            messageText = `¡${player.name} usó una Ficha Comodín! Podrá colocar cualquier ficha en el tablero este turno.`;
            break;
          case 'boneyard_reset':
            messageText = `¡${player.name} usó Reinicio Estelar y cambió toda su mano por fichas del pozo!`;
            break;
          case 'magnetic_pull':
            messageText = `¡${player.name} usó Atracción Magnética sobre ${targetPlayer ? targetPlayer.name : 'un oponente'} obligándolo a robar del pozo!`;
            break;
          case 'russian_roulette':
            messageText = `¡${player.name} activó la Ruleta Rusa! Todos los jugadores pasan una ficha al de su derecha.`;
            break;
          default:
            messageText = `¡${player.name} usó una carta de poder!`;
        }
      }

      // Propagar mensaje al chat rápido para que aparezca como toast flotante
      io.to(roomId).emit('receive_quick_message', {
        playerName: 'SISTEMA',
        text: messageText,
        type: 'phrase'
      });

      // El Ojo Soplón revela por tiempo: hay que reemitir al caducar.
      if (cardId === 'spy_eye' && game.activeEffects.spyEyeEndTime) {
        scheduleEffectExpiry(roomId, game.activeEffects.spyEyeEndTime - Date.now());
      }

      advanceRoom(roomId);
      broadcastGameState(roomId);
    } else {
      socket.emit('error_msg', result.error);
    }
  });

  // 7. Siguiente ronda (cuando finaliza una)
  socket.on('next_round', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    if (game.status === 'round_ended') {
      game.startNewRound();
      io.to(roomId).emit('play_sound', { type: 'shuffle' });
      advanceRoom(roomId);
      broadcastGameState(roomId);
    }
  });

  // 8. Reiniciar juego (jugar de nuevo al finalizar la partida)
  socket.on('play_again', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    if (game.status === 'game_ended' || game.status === 'round_ended') {
      game.startNewGame();
      io.to(roomId).emit('play_sound', { type: 'shuffle' });
      advanceRoom(roomId);
      broadcastGameState(roomId);
    }
  });

  // 9. Mensajes rápidos y Emojis
  socket.on('send_quick_message', ({ roomId, playerId, text, type }) => {
    // type: 'phrase' o 'emoji'
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

  // 10. Desconexión
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
    
    // Buscar la sala donde estaba este socket
    for (const [roomId, game] of rooms.entries()) {
      const player = game.players.find(p => p.socketId === socket.id);
      if (player) {
        if (game.status === 'waiting') {
          // Si estaba esperando, lo sacamos de inmediato
          game.removePlayer(socket.id);
          console.log(`Jugador ${player.name} abandonó la sala en espera ${roomId}`);
          
          // Con bots la sala nunca queda en 0 jugadores: lo que la vacía de
          // verdad es que no quede ningún humano.
          if (!game.hasHumans()) {
            rooms.delete(roomId);
            clearRoomTimers(roomId);
            console.log(`Sala sin humanos eliminada: ${roomId}`);
          } else {
            broadcastGameState(roomId);
          }
        } else {
          // Si la partida está activa, no lo eliminamos, marcamos socketId como nulo para darle tiempo a reconectar
          player.socketId = null;
          broadcastGameState(roomId);
          console.log(`Jugador ${player.name} se desconectó temporalmente de la sala activa ${roomId}`);
          
          // Limpieza de sala si todos están desconectados
          const allOffline = game.players.every(p => p.socketId === null);
          if (allOffline) {
            // Dar 2 minutos antes de borrar la sala entera
            setTimeout(() => {
              const checkGame = rooms.get(roomId);
              if (checkGame && checkGame.players.every(p => p.socketId === null)) {
                rooms.delete(roomId);
                clearRoomTimers(roomId);
                console.log(`Sala ${roomId} eliminada por inactividad prolongada (todos offline).`);
              }
            }, 120000);
          }
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
