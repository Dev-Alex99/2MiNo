const BaseGame = require('../../core/BaseGame');
const GameRegistry = require('../../core/GameRegistry');

/**
 * TemplateGame - Plantilla base para desarrollar nuevos juegos en el Hub.
 * Copia esta carpeta como `server/games/mi_nuevo_juego/` e implementa las reglas.
 */
class TemplateGame extends BaseGame {
  constructor(roomId, options = {}) {
    super('template_game', roomId, options);
    this.maxPlayers = options.maxPlayers || 4;
    this.boardState = {};
    this.turnDurationMs = options.turnDurationMs || 30000;
    this.currentPlayerIndex = 0;
  }

  startNewGame() {
    this.status = 'playing';
    this.roundNumber += 1;
    this.boardState = { message: '¡Partida Iniciada!' };
    this.players.forEach(p => {
      p.score = 0;
    });
  }

  handleAction(playerId, actionType, payload = {}) {
    if (this.status !== 'playing') {
      return { success: false, error: 'La partida no está activa' };
    }

    const currentPlayer = this.players[this.currentPlayerIndex];
    if (currentPlayer.id !== playerId) {
      return { success: false, error: 'No es tu turno' };
    }

    switch (actionType) {
      case 'make_move':
        // Lógica del movimiento del nuevo juego
        this.boardState.lastMove = payload;
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        return { success: true };
      default:
        return { success: false, error: 'Acción no reconocida' };
    }
  }

  getSharedState() {
    return {
      gameType: this.gameType,
      roomId: this.roomId,
      status: this.status,
      roundNumber: this.roundNumber,
      currentPlayerIndex: this.currentPlayerIndex,
      currentPlayerId: this.players[this.currentPlayerIndex]?.id || null,
      boardState: this.boardState,
      turnEndsAt: this.turnEndsAt,
      options: this.options
    };
  }

  getGameStateForPlayer(playerId, sharedState) {
    const shared = sharedState || this.getSharedState();
    return {
      ...shared,
      isSpectator: false,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        score: p.score,
        isCurrent: p.id === shared.currentPlayerId
      }))
    };
  }

  getSpectatorState(sharedState) {
    const shared = sharedState || this.getSharedState();
    return {
      ...shared,
      isSpectator: true,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score
      }))
    };
  }

  forceTurn() {
    if (this.status !== 'playing') return { action: 'none' };
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    return { action: 'timeout_pass' };
  }

  addBot(name, difficulty = 'normal') {
    if (this.players.length >= this.maxPlayers) return null;
    const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
    const bot = {
      id: botId,
      name: name || 'Bot Plantilla',
      socketId: null,
      isBot: true,
      ready: true,
      score: 0,
      difficulty
    };
    this.players.push(bot);
    return bot;
  }
}

// Registrar en el Hub (descomentar cuando se instancie un juego real)
GameRegistry.register('template_game', TemplateGame, {
  name: 'Juego Plantilla (Demostración)',
  minPlayers: 2,
  maxPlayers: 4,
  description: 'Módulo plantilla para acelerar el desarrollo de nuevos juegos.'
});

module.exports = TemplateGame;
