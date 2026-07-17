const POWER_CATALOG = {
  double_shot: { id: 'double_shot', name: 'Doble Tiro', desc: 'Juega 2 fichas en este turno si ambas son válidas.', type: 'buff' },
  smuggle: { id: 'smuggle', name: 'Contrabando', desc: 'Regala una ficha de tu mano a un oponente.', type: 'attack' },
  spy_eye: { id: 'spy_eye', name: 'El Ojo Soplón', desc: 'Revela la mano de un oponente por 10 segundos.', type: 'attack' },
  skip: { id: 'skip', name: 'Salto de Turno', desc: 'Salta el turno del siguiente jugador inmediatamente.', type: 'attack' },
  draw_penalty: { id: 'draw_penalty', name: 'Multa de Pozo', desc: 'Obliga a un oponente a robar 1 ficha del pozo.', type: 'attack' },
  reverse: { id: 'reverse', name: 'Sentido Contrario', desc: 'Invierte el orden de flujo de turnos.', type: 'buff' },
  trade: { id: 'trade', name: 'Trueque', desc: 'Cambia una ficha de tu mano por una aleatoria del pozo.', type: 'buff' },
  shield: { id: 'shield', name: 'Escudo de Neón', desc: 'Inmune a ataques de oponentes hasta tu próximo turno.', type: 'defense' },
  freeze: { id: 'freeze', name: 'Congelar Extremo', desc: 'Bloquea un extremo del tablero para los oponentes este turno.', type: 'attack' },
  destiny_steal: { id: 'destiny_steal', name: 'Robo del Destino', desc: 'Roba una carta de poder al azar de un oponente.', type: 'attack' },
  mind_swap: { id: 'mind_swap', name: 'Intercambio Mental', desc: 'Intercambia tu mano completa de fichas con la de un oponente.', type: 'attack' },
  tile_demolition: { id: 'tile_demolition', name: 'Ficha Dinamita', desc: 'Elimina una ficha colocada en un extremo del tablero.', type: 'attack' },
  wildcard: { id: 'wildcard', name: 'Ficha Comodín', desc: 'Habilita colocar cualquier ficha en el tablero en este turno.', type: 'buff' },
  boneyard_reset: { id: 'boneyard_reset', name: 'Reinicio Estelar', desc: 'Devuelve tu mano al pozo, barájalo y roba la misma cantidad.', type: 'buff' },
  magnetic_pull: { id: 'magnetic_pull', name: 'Atracción Magnética', desc: 'Obliga a un oponente a robar del pozo hasta tener jugada (max 3).', type: 'attack' },
  russian_roulette: { id: 'russian_roulette', name: 'Ruleta Rusa', desc: 'Todos los jugadores pasan una ficha al azar al jugador de su derecha.', type: 'caos' }
};

// Variantes de dominó soportadas, indexadas por el valor máximo de puntos.
// - Doble 6: 28 fichas. Con 4 jugadores × 7 fichas se reparte el mazo entero (pozo vacío).
// - Doble 9: 55 fichas. Con 10 fichas por jugador siempre queda pozo.
// El límite de puntos sube en el doble 9 porque las manos valen bastante más.
const VARIANTS = {
  6: { handSize: 7, defaultMaxScore: 100 },
  9: { handSize: 10, defaultMaxScore: 200 }
};

class DominoGame {
  // maxScore = null => usa el propio de la variante.
  // options: { powersEnabled, maxPip: 6|9, teamsEnabled, drawEnabled }
  constructor(roomId, maxScore = null, options = {}) {
    const {
      powersEnabled = true, maxPip = 6, teamsEnabled = false, drawEnabled = true,
      isPublic = true
    } = options;

    // Pública: aparece en la lista del lobby mientras espera jugadores.
    // Privada: solo se entra con el código.
    this.isPublic = isPublic !== false;

    // Administrador de la sala (puede expulsar). Se fija con el primer humano.
    this.hostId = null;

    this.maxPip = VARIANTS[maxPip] ? maxPip : 6;
    const variant = VARIANTS[this.maxPip];
    this.handSize = variant.handSize;
    this.powersEnabled = powersEnabled !== false;
    // Parejas: exige exactamente 4 jugadores. Se sientan alternados (0,2) vs (1,3),
    // así los compañeros nunca juegan seguidos.
    this.teamsEnabled = teamsEnabled === true;
    // Sin pozo: quien no tiene jugada pasa directamente, aunque queden fichas.
    this.drawEnabled = drawEnabled !== false;
    this.teamScores = [0, 0];
    this.teamNames = ['Equipo A', 'Equipo B'];

    this.roomId = roomId;
    this.maxScore = maxScore || variant.defaultMaxScore;

    // Temporizador de turno. El servidor arma el timer real; aquí solo vive la
    // duración y el instante límite para poder enviarlos al cliente.
    this.turnDurationMs = 30000;
    this.turnEndsAt = null;
    this.players = []; // { id, name, socketId, hand: [], score: 0, ready: false, powers: [], shieldActive: false }
    this.status = 'waiting'; // 'waiting' | 'playing' | 'round_ended' | 'game_ended'
    this.board = []; // Array de [val1, val2] ordenados de izquierda a derecha
    this.boneyard = []; // Fichas en el pozo
    this.currentPlayerIndex = 0;
    this.roundWinner = null;
    this.gameWinner = null;
    this.lastPlay = null; // Para historial o animaciones: { playerId, tile, side }
    this.passedTurns = 0; // Contador de turnos seguidos pasados para detectar bloqueo
    this.roundNumber = 0;
    this.startingPlayerId = null; // Quien inicia la ronda
    // playerId -> números sobre los que ya pasó. Es información pública (todos
    // ven el pase) y permite a los bots difíciles deducir y bloquear.
    this.playerPassedOn = {};
    
    // Estados activos para cartas de poderes
    this.powerDeck = [];
    this.activeEffects = {
      frozenEnd: null, // 'left' | 'right' | null
      frozenEndOwnerId: null,
      doubleTurnActive: false,
      reversed: false,
      spyEyeTargetId: null,
      spyEyeOwnerId: null,
      spyEyeEndTime: 0,
      skipNextTurn: false,
      wildcardActive: false
    };
  }

  addPlayer(id, name, socketId) {
    if (this.players.length >= 4) return null;
    if (this.status !== 'waiting') return null;

    const player = {
      id,
      name,
      socketId,
      hand: [],
      score: 0,
      ready: false,
      powers: [],
      shieldActive: false,
      isBot: false,
      team: 0
    };
    this.players.push(player);
    this.assignTeams();
    this.ensureHost();
    return player;
  }

  // El administrador de la sala: por defecto quien la creó (primer humano).
  // Si se va, lo hereda el siguiente humano presente.
  ensureHost() {
    const current = this.players.find(p => p.id === this.hostId);
    if (current && !current.isBot) return;
    const human = this.players.find(p => !p.isBot);
    this.hostId = human ? human.id : null;
  }

  // Añade un bot. Va siempre "listo": no tiene a quién esperar, así que
  // allReady() depende solo de los humanos.
  addBot(name, difficulty = 'normal') {
    if (this.players.length >= 4) return null;
    if (this.status !== 'waiting') return null;

    const bot = {
      id: `bot_${Math.random().toString(36).substring(2, 9)}`,
      name,
      socketId: null,
      hand: [],
      score: 0,
      ready: true,
      powers: [],
      shieldActive: false,
      isBot: true,
      team: 0,
      difficulty: ['facil', 'normal', 'dificil'].includes(difficulty) ? difficulty : 'normal'
    };
    this.players.push(bot);
    this.assignTeams();
    return bot;
  }

  removePlayerById(id) {
    const index = this.players.findIndex(p => p.id === id);
    if (index === -1) return null;
    const removed = this.players[index];
    this.players.splice(index, 1);
    this.assignTeams();
    this.ensureHost(); // si se fue el admin, lo hereda otro humano
    return removed;
  }

  // Equipo por asiento: pares contra impares. Al ir el turno en orden alrededor
  // de la mesa, los compañeros quedan siempre enfrentados y nunca consecutivos.
  assignTeams() {
    this.players.forEach((p, i) => { p.team = i % 2; });
  }

  // Intercambia el sitio de dos jugadores. Como el equipo se deduce del asiento,
  // esto es lo que permite elegir compañero (y cambia el orden de turnos).
  swapSeats(idA, idB) {
    if (this.status !== 'waiting') return false;
    if (idA === idB) return false;

    const a = this.players.findIndex(p => p.id === idA);
    const b = this.players.findIndex(p => p.id === idB);
    if (a === -1 || b === -1) return false;

    [this.players[a], this.players[b]] = [this.players[b], this.players[a]];
    this.assignTeams();
    return true;
  }

  // Suma de puntos que un equipo tiene aún en la mano.
  teamHandSum(team) {
    return this.players
      .filter(p => p.team === team)
      .reduce((sum, p) => sum + this.getHandSum(p.hand), 0);
  }

  // ¿Quedan humanos en la sala? Si no, no tiene sentido mantenerla viva.
  hasHumans() {
    return this.players.some(p => !p.isBot);
  }

  removePlayer(socketId) {
    const index = this.players.findIndex(p => p.socketId === socketId);
    if (index === -1) return null;

    const removedPlayer = this.players[index];
    this.players.splice(index, 1);

    // Si el juego ya había empezado, lo reiniciamos o finalizamos
    if (this.status !== 'waiting') {
      this.status = 'waiting';
      this.resetGame();
    }

    this.ensureHost(); // pudo haberse ido el admin
    return removedPlayer;
  }

  toggleReady(socketId) {
    const player = this.players.find(p => p.socketId === socketId);
    if (player) {
      player.ready = !player.ready;
    }
    return player;
  }

  allReady() {
    // En parejas la mesa tiene que estar completa: 2v2 no se juega a 3.
    if (this.teamsEnabled && this.players.length !== 4) return false;
    return this.players.length >= 2 && this.players.every(p => p.ready);
  }

  resetGame() {
    this.board = [];
    this.boneyard = [];
    this.currentPlayerIndex = 0;
    this.roundWinner = null;
    this.gameWinner = null;
    this.lastPlay = null;
    this.passedTurns = 0;
    this.roundNumber = 0;
    this.players.forEach(p => {
      p.hand = [];
      p.score = 0;
      p.ready = false;
      p.powers = [];
      p.shieldActive = false;
    });
    this.activeEffects = {
      frozenEnd: null,
      frozenEndOwnerId: null,
      doubleTurnActive: false,
      reversed: false,
      spyEyeTargetId: null,
      spyEyeOwnerId: null,
      spyEyeEndTime: 0,
      skipNextTurn: false,
      wildcardActive: false
    };
    this.status = 'waiting';
  }

  startNewGame() {
    this.players.forEach(p => p.score = 0);
    this.teamScores = [0, 0];
    this.gameWinnerTeam = null;
    this.roundWinnerTeam = null;
    this.roundNumber = 0;
    this.assignTeams();
    this.startNewRound();
  }

  startNewRound() {
    this.roundNumber++;
    this.board = [];
    this.lastPlay = null;
    this.passedTurns = 0;
    this.roundWinner = null;
    this.playerPassedOn = {};
    this.status = 'playing';

    // Inicializar efectos activos de poderes
    this.activeEffects = {
      frozenEnd: null,
      frozenEndOwnerId: null,
      doubleTurnActive: false,
      reversed: false,
      spyEyeTargetId: null,
      spyEyeOwnerId: null,
      spyEyeEndTime: 0,
      skipNextTurn: false,
      wildcardActive: false
    };

    // Generar mazo de cartas de poderes (2 de cada una). En modo clásico no se usa.
    this.powerDeck = [];
    if (this.powersEnabled) {
      const allPowers = [];
      Object.keys(POWER_CATALOG).forEach(key => {
        allPowers.push({ ...POWER_CATALOG[key] });
        allPowers.push({ ...POWER_CATALOG[key] });
      });
      this.shuffle(allPowers);
      this.powerDeck = allPowers;
    }

    // Generar las fichas de la variante (doble 6 => 28, doble 9 => 55)
    const deck = [];
    for (let i = 0; i <= this.maxPip; i++) {
      for (let j = i; j <= this.maxPip; j++) {
        deck.push([i, j]);
      }
    }

    // Barajar
    this.shuffle(deck);

    // Repartir fichas y (si aplica) 2 poderes a cada jugador
    const numPlayers = this.players.length;
    this.players.forEach(p => {
      p.hand = [];
      p.powers = this.powersEnabled ? [this.powerDeck.pop(), this.powerDeck.pop()] : [];
      p.shieldActive = false;
    });

    // Nunca repartir más fichas de las que hay en el mazo.
    const dealCount = Math.min(this.handSize, Math.floor(deck.length / numPlayers));
    for (let i = 0; i < dealCount; i++) {
      for (let p = 0; p < numPlayers; p++) {
        this.players[p].hand.push(deck.pop());
      }
    }

    // El resto va al pozo
    this.boneyard = deck;

    // Determinar quién empieza la ronda
    if (this.roundNumber === 1) {
      // Primera ronda: empieza quien tenga el doble 6 (o el doble más alto)
      let starterIndex = 0;
      let highestDouble = -1;
      let highestTileSum = -1;

      for (let p = 0; p < numPlayers; p++) {
        const player = this.players[p];
        player.hand.forEach(tile => {
          if (tile[0] === tile[1]) {
            if (tile[0] > highestDouble) {
              highestDouble = tile[0];
              starterIndex = p;
            }
          } else {
            const sum = tile[0] + tile[1];
            if (sum > highestTileSum) {
              highestTileSum = sum;
              if (highestDouble === -1) {
                starterIndex = p;
              }
            }
          }
        });
      }

      this.currentPlayerIndex = starterIndex;
      this.startingPlayerId = this.players[starterIndex].id;
    } else {
      // Rondas siguientes: empieza el ganador de la ronda anterior
      const prevWinnerId = this.startingPlayerId; // O el ganador real de la ronda
      const idx = this.players.findIndex(p => p.id === prevWinnerId);
      this.currentPlayerIndex = idx !== -1 ? idx : 0;
    }
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  getLeftEnd() {
    if (this.board.length === 0) return null;
    return this.board[0][0];
  }

  getRightEnd() {
    if (this.board.length === 0) return null;
    return this.board[this.board.length - 1][1];
  }

  // Verifica si un jugador tiene movimientos válidos
  hasValidMove(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return false;

    if (this.activeEffects.wildcardActive) return player.hand.length > 0;

    // Si el tablero está vacío, cualquier ficha es válida
    if (this.board.length === 0) return true;

    const left = this.getLeftEnd();
    const right = this.getRightEnd();

    const isLeftFrozenForMe = this.activeEffects.frozenEnd === 'left' && this.activeEffects.frozenEndOwnerId !== playerId;
    const isRightFrozenForMe = this.activeEffects.frozenEnd === 'right' && this.activeEffects.frozenEndOwnerId !== playerId;

    return player.hand.some(tile => {
      const matchesLeft = tile[0] === left || tile[1] === left;
      const matchesRight = tile[0] === right || tile[1] === right;
      
      const canPlayL = matchesLeft && !isLeftFrozenForMe;
      const canPlayR = matchesRight && !isRightFrozenForMe;
      
      return canPlayL || canPlayR;
    });
  }

  // Devuelve TODAS las jugadas legales de un jugador: [{ tileIndex, side }, ...]
  // Respeta extremos congelados y el comodín, igual que hasValidMove().
  getValidMoves(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.hand.length === 0) return [];

    // Tablero vacío: cualquier ficha vale.
    if (this.board.length === 0) {
      return player.hand.map((_, i) => ({ tileIndex: i, side: 'left' }));
    }

    const left = this.getLeftEnd();
    const right = this.getRightEnd();
    const leftFrozen = this.activeEffects.frozenEnd === 'left' && this.activeEffects.frozenEndOwnerId !== playerId;
    const rightFrozen = this.activeEffects.frozenEnd === 'right' && this.activeEffects.frozenEndOwnerId !== playerId;

    const moves = [];
    for (let i = 0; i < player.hand.length; i++) {
      const tile = player.hand[i];

      if (this.activeEffects.wildcardActive) {
        if (!leftFrozen) moves.push({ tileIndex: i, side: 'left' });
        if (!rightFrozen) moves.push({ tileIndex: i, side: 'right' });
        continue;
      }

      if (!leftFrozen && (tile[0] === left || tile[1] === left)) moves.push({ tileIndex: i, side: 'left' });
      if (!rightFrozen && (tile[0] === right || tile[1] === right)) moves.push({ tileIndex: i, side: 'right' });
    }
    return moves;
  }

  // Primera jugada legal, o null. Base del turno forzado por tiempo.
  findValidMove(playerId) {
    return this.getValidMoves(playerId)[0] || null;
  }

  // Valor que quedaría expuesto en ese extremo tras la jugada. null si el
  // tablero está vacío (ahí no hay todavía un extremo que "heredar").
  resultingEnd(playerId, move) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || this.board.length === 0) return null;
    const tile = player.hand[move.tileIndex];
    if (!tile) return null;

    if (move.side === 'left') {
      const left = this.getLeftEnd();
      return tile[1] === left ? tile[0] : tile[1];
    }
    const right = this.getRightEnd();
    return tile[0] === right ? tile[1] : tile[0];
  }

  // Resuelve el turno del jugador activo cuando se le acaba el tiempo.
  // Aplica las mismas reglas que si jugara él: si tiene jugada, está obligado a
  // jugarla; si no, roba mientras haya pozo; y solo pasa si no queda otra.
  forceTurn() {
    if (this.status !== 'playing') return { action: 'none' };

    const player = this.players[this.currentPlayerIndex];
    if (!player) return { action: 'none' };

    let move = this.findValidMove(player.id);
    let drew = 0;

    while (!move && this.drawEnabled && this.boneyard.length > 0) {
      const drawn = this.drawTile(player.id);
      if (!drawn.success) break;
      drew++;
      move = this.findValidMove(player.id);
    }

    if (move) {
      const played = this.playTile(player.id, move.tileIndex, move.side);
      if (played.success) {
        return { action: 'played', playerId: player.id, playerName: player.name, drew };
      }
    }

    const passed = this.passTurn(player.id);
    if (passed.success) {
      return { action: 'passed', playerId: player.id, playerName: player.name, drew };
    }

    // Salvavidas: si ni jugar ni pasar es legal, avanzamos igualmente para no
    // dejar la mesa bloqueada, que es justo lo que este método existe para evitar.
    this.nextTurn();
    return { action: 'skipped', playerId: player.id, playerName: player.name, drew };
  }

  // Ejecuta una jugada: tileIndex de la mano del jugador en un lado ('left' o 'right')
  playTile(playerId, tileIndex, side) {
    const player = this.players[this.currentPlayerIndex];
    if (!player || player.id !== playerId) return { success: false, error: 'No es tu turno' };
    if (this.status !== 'playing') return { success: false, error: 'El juego no está activo' };

    const tile = player.hand[tileIndex];
    if (!tile) return { success: false, error: 'Ficha no encontrada en la mano' };

    const isLeftFrozenForMe = this.activeEffects.frozenEnd === 'left' && this.activeEffects.frozenEndOwnerId !== playerId;
    const isRightFrozenForMe = this.activeEffects.frozenEnd === 'right' && this.activeEffects.frozenEndOwnerId !== playerId;

    if (side === 'left' && isLeftFrozenForMe) {
      return { success: false, error: 'El extremo izquierdo está congelado por un poder enemigo' };
    }
    if (side === 'right' && isRightFrozenForMe) {
      return { success: false, error: 'El extremo derecho está congelado por un poder enemigo' };
    }

    if (this.board.length === 0) {
      // Primera ficha en el tablero
      this.board.push(tile);
      player.hand.splice(tileIndex, 1);
      this.lastPlay = { playerId, tile, side: 'left' };
      this.passedTurns = 0;
      this.checkRoundEnd();
      if (this.status === 'playing') {
        if (this.activeEffects.doubleTurnActive) {
          this.activeEffects.doubleTurnActive = false;
        } else {
          this.nextTurn();
        }
      }
      return { success: true };
    }

    const left = this.getLeftEnd();
    const right = this.getRightEnd();
    let playedTile = [...tile];
    let isValid = false;

    if (this.activeEffects.wildcardActive) {
      if (side === 'left') {
        if (playedTile[0] === left) {
          playedTile = [playedTile[1], playedTile[0]];
        }
        this.board.unshift(playedTile);
      } else if (side === 'right') {
        if (playedTile[1] === right) {
          playedTile = [playedTile[1], playedTile[0]];
        }
        this.board.push(playedTile);
      }
      isValid = true;
      this.activeEffects.wildcardActive = false;
    } else {
      if (side === 'left') {
        if (playedTile[1] === left) {
          // Conecta directo
          this.board.unshift(playedTile);
          isValid = true;
        } else if (playedTile[0] === left) {
          // Necesita rotación
          playedTile = [playedTile[1], playedTile[0]];
          this.board.unshift(playedTile);
          isValid = true;
        }
      } else if (side === 'right') {
        if (playedTile[0] === right) {
          // Conecta directo
          this.board.push(playedTile);
          isValid = true;
        } else if (playedTile[1] === right) {
          // Necesita rotación
          playedTile = [playedTile[1], playedTile[0]];
          this.board.push(playedTile);
          isValid = true;
        }
      }
    }

    if (!isValid) {
      return { success: false, error: 'Movimiento inválido para ese lado' };
    }

    // Remover ficha de la mano del jugador
    player.hand.splice(tileIndex, 1);
    this.lastPlay = { playerId, tile: playedTile, side };
    this.passedTurns = 0; // Reseteamos contador de pases

    this.checkRoundEnd();
    if (this.status === 'playing') {
      if (this.activeEffects.doubleTurnActive) {
        this.activeEffects.doubleTurnActive = false;
      } else {
        this.nextTurn();
      }
    }

    return { success: true };
  }

  // Robar del pozo
  drawTile(playerId) {
    const player = this.players[this.currentPlayerIndex];
    if (!player || player.id !== playerId) return { success: false, error: 'No es tu turno' };
    if (!this.drawEnabled) return { success: false, error: 'En esta sala no se roba del pozo: si no tienes jugada, pasa' };
    if (this.boneyard.length === 0) return { success: false, error: 'El pozo está vacío' };
    if (this.hasValidMove(playerId)) return { success: false, error: 'Tienes jugadas disponibles, no puedes robar' };

    const drawnTile = this.boneyard.pop();
    player.hand.push(drawnTile);
    this.passedTurns = 0; // Un robo no cuenta como pase trancado

    return { success: true, tile: drawnTile };
  }

  // Pasar turno
  passTurn(playerId) {
    const player = this.players[this.currentPlayerIndex];
    if (!player || player.id !== playerId) return { success: false, error: 'No es tu turno' };
    // Solo estás obligado a robar si la sala permite robar.
    if (this.drawEnabled && this.boneyard.length > 0) {
      return { success: false, error: 'Quedan fichas en el pozo, debes robar' };
    }
    if (this.hasValidMove(playerId)) return { success: false, error: 'Tienes jugadas disponibles, no puedes pasar' };

    // Un pase es información pública: revela que ese jugador no tiene NINGUNO
    // de los dos extremos. Lo guardamos para que los bots difíciles bloqueen.
    if (this.board.length > 0) {
      const seen = this.playerPassedOn[playerId] || [];
      [this.getLeftEnd(), this.getRightEnd()].forEach(v => {
        if (!seen.includes(v)) seen.push(v);
      });
      this.playerPassedOn[playerId] = seen;
    }

    this.passedTurns++;
    this.lastPlay = { playerId, tile: null, side: 'pass' };

    this.checkRoundEnd();
    if (this.status === 'playing') {
      this.nextTurn();
    }
    return { success: true };
  }

  nextTurn() {
    let step = 1;
    let skippedPlayerIndex = null;
    if (this.activeEffects.skipNextTurn) {
      this.activeEffects.skipNextTurn = false;
      step = 2;
      skippedPlayerIndex = this.activeEffects.reversed
        ? (this.currentPlayerIndex - 1 + this.players.length) % this.players.length
        : (this.currentPlayerIndex + 1) % this.players.length;
    }

    // Siguiente índice respetando orden inverso y saltos
    if (this.activeEffects.reversed) {
      this.currentPlayerIndex = (this.currentPlayerIndex - step + this.players.length) % this.players.length;
    } else {
      this.currentPlayerIndex = (this.currentPlayerIndex + step) % this.players.length;
    }

    // El escudo del jugador saltado se apaga
    if (skippedPlayerIndex !== null) {
      const skippedPlayer = this.players[skippedPlayerIndex];
      if (skippedPlayer) {
        skippedPlayer.shieldActive = false;
      }
    }

    // Desactivar escudo del jugador que entra en turno, y congelamiento si vuelve a su creador
    const activePlayer = this.players[this.currentPlayerIndex];
    if (activePlayer) {
      activePlayer.shieldActive = false;

      if (this.activeEffects.frozenEndOwnerId === activePlayer.id) {
        this.activeEffects.frozenEnd = null;
        this.activeEffects.frozenEndOwnerId = null;
      }

      this.activeEffects.wildcardActive = false;
    }
  }

  checkRoundEnd() {
    // 1. Victoria por mano vacía (Dominó)
    const dominoWinner = this.players.find(p => p.hand.length === 0);
    if (dominoWinner) {
      this.endRound(dominoWinner.id, false);
      return;
    }

    // 2. Bloqueo (Trancado): Nadie tiene jugadas y el pozo está vacío
    // Esto ocurre cuando todos los jugadores han pasado consecutivamente (igual al número de jugadores)
    if (this.passedTurns >= this.players.length) {
      this.endRound(null, true);
    }
  }

  // Cierre de ronda en parejas: puntúa el EQUIPO, y se lleva los puntos que
  // queden en las manos de los DOS rivales.
  endRoundTeams(winnerId, isBlocked) {
    let winningTeam;

    if (!isBlocked) {
      const winner = this.players.find(p => p.id === winnerId);
      winningTeam = winner.team;
      this.roundWinner = winner.id;
      this.startingPlayerId = winner.id;
    } else {
      // Tranca: gana la pareja que menos puntos tenga entre los dos.
      const totals = [this.teamHandSum(0), this.teamHandSum(1)];

      if (totals[0] === totals[1]) {
        this.roundWinner = 'tie';
        this.roundWinnerTeam = null;
        this.checkGameEndTeams();
        return;
      }

      winningTeam = totals[0] < totals[1] ? 0 : 1;
      // Sale el miembro del equipo ganador con la mano más baja.
      const starter = this.players
        .filter(p => p.team === winningTeam)
        .reduce((a, b) => (this.getHandSum(a.hand) <= this.getHandSum(b.hand) ? a : b));
      this.roundWinner = starter.id;
      this.startingPlayerId = starter.id;
    }

    const losingTeam = winningTeam === 0 ? 1 : 0;
    this.teamScores[winningTeam] += this.teamHandSum(losingTeam);
    this.roundWinnerTeam = winningTeam;
    this.checkGameEndTeams();
  }

  checkGameEndTeams() {
    const idx = this.teamScores.findIndex(s => s >= this.maxScore);
    if (idx !== -1) {
      this.status = 'game_ended';
      this.gameWinnerTeam = idx;
      this.gameWinner = `team_${idx}`;
    }
  }

  endRound(winnerId, isBlocked) {
    this.status = 'round_ended';

    if (this.teamsEnabled) return this.endRoundTeams(winnerId, isBlocked);

    let roundPoints = 0;

    if (!isBlocked) {
      // Sumar los puntos de todas las manos enemigas
      const winner = this.players.find(p => p.id === winnerId);
      this.players.forEach(p => {
        if (p.id !== winnerId) {
          roundPoints += this.getHandSum(p.hand);
        }
      });
      winner.score += roundPoints;
      this.roundWinner = winner.id;
      this.startingPlayerId = winner.id; // Empieza la siguiente
    } else {
      // En caso de tranca, gana el jugador con menos puntos en su mano
      let minScore = Infinity;
      let roundWinner = null;
      let isTie = false;

      this.players.forEach(p => {
        const handSum = this.getHandSum(p.hand);
        if (handSum < minScore) {
          minScore = handSum;
          roundWinner = p;
          isTie = false;
        } else if (handSum === minScore) {
          isTie = true; // Empate en puntos mínimos
        }
      });

      if (isTie || !roundWinner) {
        // En algunas reglas, si hay empate, nadie suma puntos.
        // Haremos que no sume nadie en esta ronda y empiece el mismo que empezó
        this.roundWinner = 'tie';
      } else {
        // El ganador suma los puntos de las manos de todos los DEMÁS
        this.players.forEach(p => {
          if (p.id !== roundWinner.id) {
            roundPoints += this.getHandSum(p.hand);
          }
        });
        roundWinner.score += roundPoints;
        this.roundWinner = roundWinner.id;
        this.startingPlayerId = roundWinner.id;
      }
    }

    // Verificar si algún jugador alcanzó los 100 puntos
    const gameWinnerPlayer = this.players.find(p => p.score >= this.maxScore);
    if (gameWinnerPlayer) {
      this.status = 'game_ended';
      this.gameWinner = gameWinnerPlayer.id;
    }
  }

  getHandSum(hand) {
    return hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
  }

  // Ejecuta el uso de una carta de poder
  usePowerCard(playerId, cardId, targetId, tileIndex) {
    if (!this.powersEnabled) {
      return { success: false, error: 'Esta sala juega en modo clásico, sin cartas de poder' };
    }

    const player = this.players.find(p => p.id === playerId);
    if (!player) return { success: false, error: 'Jugador no encontrado' };

    const activePlayer = this.players[this.currentPlayerIndex];
    if (!activePlayer || activePlayer.id !== playerId) {
      return { success: false, error: 'Solo puedes usar cartas de poder en tu turno' };
    }
    if (this.status !== 'playing') {
      return { success: false, error: 'El juego no está en curso' };
    }

    // Encontrar la carta en la mano de poderes del jugador
    const cardIdx = player.powers.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return { success: false, error: 'No posees esta carta de poder' };

    // Si el objetivo es otro jugador, verificar escudo
    let targetPlayer = null;
    if (targetId && targetId !== 'left' && targetId !== 'right') {
      targetPlayer = this.players.find(p => p.id === targetId);
      if (targetPlayer && targetPlayer.id === playerId) {
        return { success: false, error: 'No puedes seleccionarte a ti mismo como objetivo' };
      }
      if (targetPlayer && targetPlayer.shieldActive && cardId !== 'destiny_steal') {
        // Consumimos el poder pero el escudo lo anula
        player.powers.splice(cardIdx, 1);
        return { success: true, shielded: true, targetName: targetPlayer.name };
      }
    }

    // Resolver el efecto según la carta
    switch (cardId) {
      case 'double_shot':
        this.activeEffects.doubleTurnActive = true;
        break;

      case 'smuggle':
        if (tileIndex === undefined || tileIndex === null) {
          return { success: false, error: 'Debes seleccionar una ficha para regalar' };
        }
        if (!targetPlayer) return { success: false, error: 'Debes seleccionar un oponente' };
        const smuggleTile = player.hand[tileIndex];
        if (!smuggleTile) return { success: false, error: 'Ficha no encontrada en tu mano' };

        // Transferir ficha
        player.hand.splice(tileIndex, 1);
        targetPlayer.hand.push(smuggleTile);
        break;

      case 'spy_eye':
        if (!targetPlayer) return { success: false, error: 'Debes seleccionar un oponente' };
        this.activeEffects.spyEyeTargetId = targetPlayer.id;
        this.activeEffects.spyEyeOwnerId = playerId;
        this.activeEffects.spyEyeEndTime = Date.now() + 10000; // 10 segundos de revelación
        break;

      case 'skip':
        this.activeEffects.skipNextTurn = true;
        break;

      case 'draw_penalty':
        if (!targetPlayer) return { success: false, error: 'Debes seleccionar un oponente' };
        if (this.boneyard.length === 0) {
          return { success: false, error: 'El pozo de fichas está vacío' };
        }
        // El oponente roba 1 ficha
        const penaltyTile = this.boneyard.pop();
        targetPlayer.hand.push(penaltyTile);
        break;

      case 'reverse':
        this.activeEffects.reversed = !this.activeEffects.reversed;
        break;

      case 'trade':
        if (tileIndex === undefined || tileIndex === null) {
          return { success: false, error: 'Debes seleccionar una ficha para cambiar' };
        }
        if (this.boneyard.length === 0) {
          return { success: false, error: 'El pozo de fichas está vacío' };
        }
        const tradeTile = player.hand[tileIndex];
        if (!tradeTile) return { success: false, error: 'Ficha no encontrada en tu mano' };

        // Intercambiar
        const boneyardTile = this.boneyard.pop();
        player.hand[tileIndex] = boneyardTile;
        this.boneyard.push(tradeTile);
        this.shuffle(this.boneyard); // Barajar el pozo de nuevo
        break;

      case 'shield':
        player.shieldActive = true;
        break;

      case 'freeze':
        if (targetId !== 'left' && targetId !== 'right') {
          return { success: false, error: 'Debes seleccionar qué extremo congelar' };
        }
        this.activeEffects.frozenEnd = targetId;
        this.activeEffects.frozenEndOwnerId = playerId;
        break;

      case 'destiny_steal':
        if (!targetPlayer) return { success: false, error: 'Debes seleccionar un oponente' };
        if (!targetPlayer.powers || targetPlayer.powers.length === 0) {
          return { success: false, error: 'El oponente no tiene cartas de poder' };
        }
        // Robar carta al azar
        const stolenIdx = Math.floor(Math.random() * targetPlayer.powers.length);
        const stolenPower = targetPlayer.powers[stolenIdx];
        
        targetPlayer.powers.splice(stolenIdx, 1);
        player.powers.push(stolenPower);
        break;

      case 'mind_swap':
        if (!targetPlayer) return { success: false, error: 'Debes seleccionar un oponente' };
        const tempHand = player.hand;
        player.hand = targetPlayer.hand;
        targetPlayer.hand = tempHand;
        break;

      case 'tile_demolition':
        if (targetId !== 'left' && targetId !== 'right') {
          return { success: false, error: 'Debes seleccionar qué extremo demoler' };
        }
        if (this.board.length === 0) {
          return { success: false, error: 'El tablero está vacío' };
        }
        if (targetId === 'left') {
          this.board.shift();
        } else {
          this.board.pop();
        }
        this.passedTurns = 0;
        break;

      case 'wildcard':
        this.activeEffects.wildcardActive = true;
        break;

      case 'boneyard_reset':
        const handCount = player.hand.length;
        if (handCount === 0) return { success: false, error: 'No tienes fichas en tu mano' };
        this.boneyard.push(...player.hand);
        player.hand = [];
        this.shuffle(this.boneyard);
        const drawCount = Math.min(handCount, this.boneyard.length);
        for (let i = 0; i < drawCount; i++) {
          player.hand.push(this.boneyard.pop());
        }
        break;

      case 'magnetic_pull':
        if (!targetPlayer) return { success: false, error: 'Debes seleccionar un oponente' };
        let pulls = 0;
        while (pulls < 3 && this.boneyard.length > 0 && !this.hasValidMove(targetPlayer.id)) {
          targetPlayer.hand.push(this.boneyard.pop());
          pulls++;
        }
        break;

      case 'russian_roulette':
        const numPlayers = this.players.length;
        if (numPlayers < 2) return { success: false, error: 'Se necesitan al menos 2 jugadores' };
        const passedTiles = this.players.map(p => {
          if (p.hand.length === 0) return null;
          const idx = Math.floor(Math.random() * p.hand.length);
          const tile = p.hand[idx];
          p.hand.splice(idx, 1);
          return tile;
        });
        const step = this.activeEffects.reversed ? -1 : 1;
        for (let i = 0; i < numPlayers; i++) {
          const tile = passedTiles[i];
          if (!tile) continue;
          const receiverIdx = (i + step + numPlayers) % numPlayers;
          this.players[receiverIdx].hand.push(tile);
        }
        break;

      default:
        return { success: false, error: 'Poder no reconocido' };
    }

    // Quitar la carta usada de la mano del jugador
    player.powers.splice(cardIdx, 1);
    return { success: true };
  }

  // Parte del estado idéntica para TODOS los jugadores de la sala. Se calcula
  // una sola vez por difusión (ver broadcastGameState) en lugar de rehacer todo
  // el objeto —cuentas de Date.now, spread de activeEffects, etc.— por cada
  // destinatario. Solo la lista de jugadores varía por receptor (privacidad).
  getSharedState() {
    const isSpyActive = this.activeEffects.spyEyeTargetId && this.activeEffects.spyEyeEndTime > Date.now();
    return {
      roomId: this.roomId,
      status: this.status,
      maxScore: this.maxScore,
      powersEnabled: this.powersEnabled,
      maxPip: this.maxPip,
      teamsEnabled: this.teamsEnabled,
      drawEnabled: this.drawEnabled,
      isPublic: this.isPublic,
      hostId: this.hostId,
      teamScores: this.teamScores,
      teamNames: this.teamNames,
      roundWinnerTeam: this.roundWinnerTeam ?? null,
      gameWinnerTeam: this.gameWinnerTeam ?? null,
      turnEndsAt: this.turnEndsAt,
      turnDurationSeconds: Math.round(this.turnDurationMs / 1000),
      turnSecondsRemaining: this.turnEndsAt && this.status === 'playing'
        ? Math.max(0, Math.ceil((this.turnEndsAt - Date.now()) / 1000))
        : null,
      board: this.board,
      boneyardCount: this.boneyard.length,
      currentPlayerId: this.players[this.currentPlayerIndex] ? this.players[this.currentPlayerIndex].id : null,
      roundWinner: this.roundWinner,
      gameWinner: this.gameWinner,
      lastPlay: this.lastPlay,
      roundNumber: this.roundNumber,
      activeEffects: {
        ...this.activeEffects,
        spyEyeActive: isSpyActive,
        spyEyeTimeRemaining: isSpyActive ? Math.max(0, Math.round((this.activeEffects.spyEyeEndTime - Date.now()) / 1000)) : 0
      }
    };
  }

  // Retorna una versión del estado del juego lista para enviar al cliente.
  // Protege la privacidad de las fichas de los otros jugadores.
  // shared: parte común precalculada (opcional; si falta, se calcula aquí).
  getGameStateForPlayer(playerId, shared) {
    shared = shared || this.getSharedState();
    const isSpyActive = shared.activeEffects.spyEyeActive;
    const spyTargetId = this.activeEffects.spyEyeTargetId;
    const spyOwnerId = this.activeEffects.spyEyeOwnerId;

    return {
      ...shared,
      // Lo único que varía por destinatario: qué manos y poderes puede ver.
      players: this.players.map(p => {
        const isRevealedBySpy = isSpyActive && p.id === spyTargetId && spyOwnerId === playerId;

        return {
          id: p.id,
          name: p.name,
          ready: p.ready,
          score: p.score,
          team: p.team,
          inVoice: !!p.inVoice,
          camOn: !!p.camOn,
          isBot: !!p.isBot,
          difficulty: p.isBot ? p.difficulty : undefined,
          handCount: p.hand.length,
          shieldActive: p.shieldActive,
          powersCount: p.powers ? p.powers.length : 0,
          // Solo enviamos las cartas si el jugador es el destinatario
          powers: p.id === playerId ? p.powers : [],
          // Solo enviamos la mano completa si es el destinatario, el juego terminó o fue revelado por un espía
          hand: (p.id === playerId || this.status === 'round_ended' || this.status === 'game_ended' || isRevealedBySpy) ? p.hand : []
        };
      })
    };
  }
}

module.exports = DominoGame;
