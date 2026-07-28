const BaseGame = require('../core/BaseGame');

/**
 * TicTacToeGame (Tres en Raya)
 * Subclase de BaseGame para el Hub multijuegos.
 */
class TicTacToeGame extends BaseGame {
  constructor(roomId, options = {}) {
    super('tictactoe', roomId, options);
    this.minPlayers = 2;
    this.maxPlayers = 2;
    this.board = Array(9).fill(null); // Tablero 3x3 (índices 0-8)
    this.currentPlayerIdx = 0;
    this.symbols = {}; // playerId -> 'X' | 'O'
    this.winner = null; // null | 'X' | 'O' | 'draw'
    this.winningLine = null; // null | [a, b, c]
    this.scores = { X: 0, O: 0 };
    this.lastMove = null;
  }

  startNewGame() {
    if (this.players.length < 2) return false;
    this.board = Array(9).fill(null);
    this.status = 'playing';
    this.winner = null;
    this.winningLine = null;
    this.roundNumber += 1;
    this.currentPlayerIdx = (this.roundNumber - 1) % 2;
    this.lastMove = null;

    // Asignar símbolos ('X' al jugador 0, 'O' al jugador 1)
    this.symbols = {};
    if (this.players[0]) this.symbols[this.players[0].id] = 'X';
    if (this.players[1]) this.symbols[this.players[1].id] = 'O';

    this.resetTurnTimer();
    return true;
  }

  resetTurnTimer() {
    // La duración la fija roomManager desde TURN_SECONDS. Antes se leía de unas
    // `options.turnDurationSeconds` que nadie rellenaba nunca, así que la
    // variable de entorno se ignoraba y el turno duraba siempre 30 s.
    this.turnEndsAt = Date.now() + (this.turnDurationMs || 30000);
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIdx] || null;
  }

  handleAction(playerId, actionType, payload = {}) {
    if (this.status !== 'playing') {
      return { success: false, error: 'srv.err.gameNotRunning' };
    }

    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) {
      return { success: false, error: 'srv.err.notYourTurn' };
    }

    if (actionType === 'move' || actionType === 'place_symbol') {
      const cellIdx = payload.index ?? payload.cellIdx;
      if (typeof cellIdx !== 'number' || cellIdx < 0 || cellIdx > 8) {
        return { success: false, error: 'srv.err.badCell' };
      }

      if (this.board[cellIdx] !== null) {
        return { success: false, error: 'srv.err.cellTaken' };
      }

      const symbol = this.symbols[playerId];
      this.board[cellIdx] = symbol;
      this.lastMove = { playerId, index: cellIdx, symbol };

      // Comprobar victoria o empate
      const winResult = this.checkWin();
      if (winResult) {
        this.winner = winResult.winner;
        this.winningLine = winResult.line;
        this.status = 'game_ended';
        if (this.winner !== 'draw') {
          this.scores[this.winner] = (this.scores[this.winner] || 0) + 1;
          const winPlayer = this.players.find(p => this.symbols[p.id] === this.winner);
          if (winPlayer) winPlayer.score += 1;
        }
      } else {
        // Avanzar turno
        this.currentPlayerIdx = (this.currentPlayerIdx + 1) % this.players.length;
        this.resetTurnTimer();
      }

      return { success: true };
    }

    return { success: false, error: 'srv.err.unknownAction' };
  }

  checkWin() {
    for (const line of TicTacToeGame.LINEAS) {
      const [a, b, c] = line;
      if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
        return { winner: this.board[a], line };
      }
    }

    if (this.board.every(cell => cell !== null)) {
      return { winner: 'draw', line: null };
    }

    return null;
  }

  // Devuelve el contrato estándar de BaseGame: { action, playerId, playerName, drew }
  forceTurn() {
    const none = { action: 'none', playerId: null, playerName: null, drew: 0 };
    if (this.status !== 'playing') return none;
    const current = this.getCurrentPlayer();
    if (!current) return none;

    if (!this.casillasLibres().length) return none;

    // Se juega con la heurística, no al azar: al jugador se le acabó el tiempo,
    // no hay por qué castigarle además con una jugada suicida.
    const idx = this.jugadaHeuristica(this.symbols[current.id] || 'X');
    const res = this.handleAction(current.id, 'move', { index: idx });
    if (!res || !res.success) return none;
    return { action: 'played', playerId: current.id, playerName: current.name, drew: 0 };
  }

  // El bot lo pilota el ORQUESTADOR (roomManager.scheduleBotTurn), no el juego.
  //
  // Antes esto devolvía `true` y la jugada se aplicaba desde un `setTimeout`
  // privado… que nadie observaba: el estado cambiaba en el servidor y **no se
  // difundía**. El jugador movía, el bot respondía por dentro y el tablero se
  // quedaba congelado hasta que ocurriera cualquier otra cosa. Delegando en el
  // orquestador se reutiliza su ciclo (retardo de "pensar" + difusión + sonido),
  // que es justo lo que faltaba.
  handlesOwnBots() {
    return false;
  }

  addBot(name = 'Bot TresEnRaya', difficulty = 'normal') {
    if (this.players.length >= this.maxPlayers) return null;
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const bot = {
      id: botId,
      name: name || 'Bot TresEnRaya',
      isBot: true,
      difficulty,
      ready: true,
      score: 0
    };
    this.players.push(bot);
    this.ensureHost();
    // No se arranca la partida aquí: la mesa se pone en marcha cuando todos
    // están listos (`allReady`), igual que en dominó. Antes empezaba sola al
    // añadir el bot, sin que el humano hubiera pulsado "listo".
    return bot;
  }

  /** Contrato de BaseGame: el orquestador llama, aplica y difunde. */
  playBotTurn(botId) {
    const bot = this.players.find(p => p.id === botId);
    if (!bot || this.status !== 'playing') return { action: 'none' };

    const symbol = this.symbols[botId];
    if (!symbol) return { action: 'none' };

    const index = this.elegirJugada(symbol, bot.difficulty);
    if (index === null) return { action: 'none' };

    const res = this.handleAction(botId, 'move', { index });
    return res && res.success ? { action: 'played', index } : { action: 'none' };
  }

  casillasLibres(board = this.board) {
    const libres = [];
    for (let i = 0; i < board.length; i++) if (board[i] === null) libres.push(i);
    return libres;
  }

  /**
   * Elige jugada según la dificultad.
   *
   * Antes los cuatro niveles del selector eran decorativos: el motor comparaba
   * `difficulty === 'easy'` (en inglés) pero el cliente manda 'facil', 'normal',
   * 'dificil' y 'maestro', así que NINGUNO entraba en la rama aleatoria y los
   * cuatro jugaban exactamente igual.
   */
  elegirJugada(mySymbol, difficulty = 'normal') {
    const libres = this.casillasLibres();
    if (!libres.length) return null;

    const alAzar = () => libres[Math.floor(Math.random() * libres.length)];

    switch (difficulty) {
      case 'facil':
        return alAzar();
      case 'dificil':
      case 'maestro':
        // Juego perfecto: no se le puede ganar, sólo empatar.
        return this.mejorJugadaMinimax(mySymbol);
      case 'normal':
      default:
        return this.jugadaHeuristica(mySymbol);
    }
  }

  /** Ganar > bloquear > centro > esquina > lado. Buena, pero cae en horquillas. */
  jugadaHeuristica(mySymbol) {
    const rival = mySymbol === 'X' ? 'O' : 'X';
    const libres = this.casillasLibres();

    for (const idx of libres) {
      this.board[idx] = mySymbol;
      const win = this.checkWin();
      this.board[idx] = null;
      if (win && win.winner === mySymbol) return idx;
    }

    for (const idx of libres) {
      this.board[idx] = rival;
      const win = this.checkWin();
      this.board[idx] = null;
      if (win && win.winner === rival) return idx;
    }

    if (libres.includes(4)) return 4;

    const esquinas = [0, 2, 6, 8].filter(c => libres.includes(c));
    if (esquinas.length) return esquinas[Math.floor(Math.random() * esquinas.length)];

    return libres[Math.floor(Math.random() * libres.length)];
  }

  /**
   * Minimax con la profundidad en la puntuación: entre dos victorias prefiere la
   * más rápida y entre dos derrotas la más lenta. Sin eso el bot alarga partidas
   * ya ganadas y parece que juega mal.
   *
   * El tablero tiene como mucho 9! = 362.880 partidas, así que se explora
   * entero sin poda y sin coste apreciable.
   */
  mejorJugadaMinimax(mySymbol) {
    const rival = mySymbol === 'X' ? 'O' : 'X';
    const tablero = [...this.board];

    let mejor = null;
    let mejorValor = -Infinity;
    for (const idx of this.casillasLibres(tablero)) {
      tablero[idx] = mySymbol;
      const valor = this.minimax(tablero, mySymbol, rival, 1, false);
      tablero[idx] = null;
      if (valor > mejorValor) {
        mejorValor = valor;
        mejor = idx;
      }
    }
    return mejor;
  }

  minimax(tablero, mySymbol, rival, profundidad, maximizando) {
    const ganador = TicTacToeGame.ganadorDe(tablero);
    if (ganador === mySymbol) return 10 - profundidad;   // ganar antes, mejor
    if (ganador === rival) return profundidad - 10;      // perder tarde, menos malo
    if (ganador === 'draw') return 0;

    const libres = this.casillasLibres(tablero);
    let valor = maximizando ? -Infinity : Infinity;
    for (const idx of libres) {
      tablero[idx] = maximizando ? mySymbol : rival;
      const v = this.minimax(tablero, mySymbol, rival, profundidad + 1, !maximizando);
      tablero[idx] = null;
      valor = maximizando ? Math.max(valor, v) : Math.min(valor, v);
    }
    return valor;
  }

  /** Ganador de un tablero cualquiera: 'X' | 'O' | 'draw' | null. Estático para
   *  poder evaluar tableros hipotéticos sin tocar el estado de la partida. */
  static ganadorDe(tablero) {
    for (const [a, b, c] of TicTacToeGame.LINEAS) {
      if (tablero[a] && tablero[a] === tablero[b] && tablero[a] === tablero[c]) return tablero[a];
    }
    return tablero.every(c => c !== null) ? 'draw' : null;
  }

  /**
   * El ganador del tres en raya vive en `winner` y es un SÍMBOLO ('X'/'O'), no
   * un playerId. El historial y el ELO esperan un playerId, así que se traduce
   * aquí. Sin esto toda partida se guardaba como empate.
   */
  getWinnerId() {
    if (this.winner === 'draw') return 'tie';
    if (!this.winner) return null;
    const ganador = this.players.find(p => this.symbols[p.id] === this.winner);
    return ganador ? ganador.id : null;
  }

  getVariantLabel() {
    return 'tictactoe';
  }

  getSharedState() {
    return {
      gameType: this.gameType,
      roomId: this.roomId,
      status: this.status,
      // El cliente los necesita para saber si la mesa está llena y quién manda
      // en ella: sin `maxPlayers` daba por hecho 4 y sin `hostId` nadie podía
      // expulsar.
      maxPlayers: this.maxPlayers,
      hostId: this.hostId,
      roundNumber: this.roundNumber,
      board: this.board,
      currentPlayerId: this.getCurrentPlayer() ? this.getCurrentPlayer().id : null,
      turnEndsAt: this.turnEndsAt,
      turnSecondsRemaining: this.turnEndsAt ? Math.max(0, Math.ceil((this.turnEndsAt - Date.now()) / 1000)) : 0,
      symbols: this.symbols,
      winner: this.winner,
      winningLine: this.winningLine,
      scores: this.scores,
      lastMove: this.lastMove,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        ready: p.ready,
        score: p.score,
        symbol: this.symbols[p.id] || null
      }))
    };
  }

  getGameStateForPlayer(playerId, sharedState) {
    return sharedState || this.getSharedState();
  }

  getSpectatorState(sharedState) {
    return sharedState || this.getSharedState();
  }
}

// Las 8 líneas que dan la victoria: 3 filas, 3 columnas y 2 diagonales.
TicTacToeGame.LINEAS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const GameRegistry = require('../core/GameRegistry');
GameRegistry.register('tictactoe', TicTacToeGame, {
  name: 'Tres en Raya',
  minPlayers: 2,
  maxPlayers: 2,
  description: 'Duelos clásicos 3x3 de X y O'
});

module.exports = TicTacToeGame;
