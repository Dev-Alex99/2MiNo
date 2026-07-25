const BaseGame = require('../core/BaseGame');

/**
 * TicTacToeGame (Tres en Raya)
 * Subclase de BaseGame para el Hub multijuegos.
 */
class TicTacToeGame extends BaseGame {
  constructor(roomId, options = {}) {
    super('tictactoe', roomId, options);
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
    this.triggerBotTurnIfNeeded();
    return true;
  }

  resetTurnTimer() {
    this.turnDurationMs = (this.options.turnDurationSeconds || 30) * 1000;
    this.turnEndsAt = Date.now() + this.turnDurationMs;
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIdx] || null;
  }

  handleAction(playerId, actionType, payload = {}) {
    if (this.status !== 'playing') {
      return { success: false, error: 'La partida no está en curso' };
    }

    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) {
      return { success: false, error: 'No es tu turno' };
    }

    if (actionType === 'move' || actionType === 'place_symbol') {
      const cellIdx = payload.index ?? payload.cellIdx;
      if (typeof cellIdx !== 'number' || cellIdx < 0 || cellIdx > 8) {
        return { success: false, error: 'Casilla inválida' };
      }

      if (this.board[cellIdx] !== null) {
        return { success: false, error: 'Casilla ya ocupada' };
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
        this.triggerBotTurnIfNeeded();
      }

      return { success: true };
    }

    return { success: false, error: 'Acción no reconocida' };
  }

  checkWin() {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // Filas
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columnas
      [0, 4, 8], [2, 4, 6]             // Diagonales
    ];

    for (const line of lines) {
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

    // Encontrar casillas vacías y jugar automáticamente
    const emptyIndices = this.board
      .map((val, idx) => (val === null ? idx : null))
      .filter(val => val !== null);

    if (emptyIndices.length === 0) return none;

    // Seleccionar una casilla aleatoria
    const randomIdx = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    const res = this.handleAction(current.id, 'move', { index: randomIdx });
    if (!res || !res.success) return none;
    return { action: 'played', playerId: current.id, playerName: current.name, drew: 0 };
  }

  // Este juego mueve a sus propios bots (triggerBotTurnIfNeeded), así que el
  // orquestador no debe programarlos con el botLogic de dominó.
  handlesOwnBots() {
    return true;
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

    if (this.players.length === 2 && this.status === 'waiting') {
      this.startNewGame();
    }
    return bot;
  }

  triggerBotTurnIfNeeded() {
    const current = this.getCurrentPlayer();
    if (current && current.isBot && this.status === 'playing') {
      setTimeout(() => {
        if (this.status !== 'playing') return;
        const botCurrent = this.getCurrentPlayer();
        if (!botCurrent || !botCurrent.isBot || botCurrent.id !== current.id) return;

        const symbol = this.symbols[botCurrent.id];
        const opponentSymbol = symbol === 'X' ? 'O' : 'X';

        const bestIndex = this.getBestBotMove(symbol, opponentSymbol, botCurrent.difficulty);
        this.handleAction(botCurrent.id, 'move', { index: bestIndex });
      }, 600);
    }
  }

  getBestBotMove(mySymbol, opponentSymbol, difficulty) {
    const emptyIndices = this.board
      .map((val, idx) => (val === null ? idx : null))
      .filter(val => val !== null);

    if (emptyIndices.length === 0) return 0;

    // Si es fácil, juega aleatorio
    if (difficulty === 'easy') {
      return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    }

    // 1. Ganar si hay jugada ganadora directa
    for (const idx of emptyIndices) {
      this.board[idx] = mySymbol;
      const win = this.checkWin();
      this.board[idx] = null;
      if (win && win.winner === mySymbol) return idx;
    }

    // 2. Bloquear al rival si tiene jugada ganadora
    for (const idx of emptyIndices) {
      this.board[idx] = opponentSymbol;
      const win = this.checkWin();
      this.board[idx] = null;
      if (win && win.winner === opponentSymbol) return idx;
    }

    // 3. Tomar el centro (4) si está libre
    if (emptyIndices.includes(4)) return 4;

    // 4. Tomar esquinas (0, 2, 6, 8)
    const corners = [0, 2, 6, 8].filter(c => emptyIndices.includes(c));
    if (corners.length > 0) {
      return corners[Math.floor(Math.random() * corners.length)];
    }

    return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  }

  getSharedState() {
    return {
      gameType: this.gameType,
      roomId: this.roomId,
      status: this.status,
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

const GameRegistry = require('../core/GameRegistry');
GameRegistry.register('tictactoe', TicTacToeGame, {
  name: 'Tres en Raya',
  minPlayers: 2,
  maxPlayers: 2,
  description: 'Duelos clásicos 3x3 de X y O'
});

module.exports = TicTacToeGame;
