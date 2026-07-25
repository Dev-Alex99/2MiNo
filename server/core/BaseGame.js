/**
 * Clase Abstracta BaseGame
 * Define el contrato estándar que debe implementar cualquier juego dentro del Hub.
 */
class BaseGame {
  constructor(gameType, roomId, options = {}) {
    if (new.target === BaseGame) {
      throw new Error('BaseGame es una clase abstracta y no puede instanciarse directamente.');
    }
    this.gameType = gameType; // Ej: 'domino', 'ludo', 'chess', 'uno'
    this.roomId = roomId;
    this.options = options;
    this.players = [];
    this.status = 'waiting'; // 'waiting', 'playing', 'game_ended'
    this.roundNumber = 0;
    this.turnDurationMs = 30000;
    this.turnEndsAt = null;
    this.isPublic = options.isPublic !== false;
    this.ranked = options.ranked === true;
    this.tournamentId = options.tournamentId || null;
    this.tournamentSlot = options.tournamentSlot || null;
  }

  // --- Métodos Obligatorios a Implementar por Cada Juego ---

  /** Inicia la partida / nueva ronda */
  startNewGame() {
    throw new Error(`El juego '${this.gameType}' no implementa startNewGame()`);
  }

  /** Procesa una acción del jugador (ej. jugar ficha, mover ficha en Ludo) */
  handleAction(playerId, actionType, payload) {
    throw new Error(`El juego '${this.gameType}' no implementa handleAction()`);
  }

  /** Devuelve el estado compartido del juego (sin filtros) */
  getSharedState() {
    throw new Error(`El juego '${this.gameType}' no implementa getSharedState()`);
  }

  /** Devuelve el estado filtrado para un jugador específico (niebla de guerra/mano propia) */
  getGameStateForPlayer(playerId, sharedState) {
    throw new Error(`El juego '${this.gameType}' no implementa getGameStateForPlayer()`);
  }

  /** Devuelve el estado filtrado para un espectador */
  getSpectatorState(sharedState) {
    throw new Error(`El juego '${this.gameType}' no implementa getSpectatorState()`);
  }

  /**
   * Ejecuta una jugada por defecto cuando se agota el tiempo de turno.
   * CONTRATO DE RETORNO (lo consume roomManager.armTurnTimer para narrar el
   * timeout): { action, playerId, playerName, drew }
   *  - action: 'played' | 'passed' | 'skipped' | 'none'
   *            ('skipped' = salvavidas: ni jugar ni pasar era legal, se avanzó
   *             el turno igualmente; 'none' ⇒ no hay nada que narrar)
   *  - drew:   nº de fichas robadas antes de resolver (0 si no aplica)
   */
  forceTurn() {
    throw new Error(`El juego '${this.gameType}' no implementa forceTurn()`);
  }

  /**
   * Jugador al que le toca. Cada juego mantiene su propio índice interno
   * (`currentPlayerIndex` en dominó, `currentPlayerIdx` en tres en raya), así
   * que el orquestador NUNCA debe leer esos campos directamente.
   */
  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex] || null;
  }

  /**
   * ¿Pilota el propio juego los turnos de sus bots? Si devuelve true, el
   * orquestador no programa jugadas de bot (el juego ya lo hace internamente,
   * como TicTacToeGame.triggerBotTurnIfNeeded).
   */
  handlesOwnBots() {
    return false;
  }

  /**
   * Ejecuta el turno del bot indicado. Solo se llama si handlesOwnBots() es
   * false. Devuelve { action, tile } para que el orquestador emita sonidos.
   */
  playBotTurn(_botId) {
    throw new Error(`El juego '${this.gameType}' no implementa playBotTurn()`);
  }

  /** Añade un bot al juego */
  addBot(name, difficulty) {
    throw new Error(`El juego '${this.gameType}' no implementa addBot()`);
  }

  // --- Métodos Comunes (Sobrescribibles si es necesario) ---

  addPlayer(id, name, socketId = null) {
    if (this.players.length >= (this.maxPlayers || 4)) return null;
    const player = {
      id,
      name,
      socketId,
      isBot: false,
      ready: false,
      score: 0
    };
    this.players.push(player);
    return player;
  }

  removePlayer(socketId) {
    const idx = this.players.findIndex(p => p.socketId === socketId);
    if (idx !== -1) {
      return this.players.splice(idx, 1)[0];
    }
    return null;
  }

  hasHumans() {
    return this.players.some(p => !p.isBot && p.socketId !== null);
  }
}

module.exports = BaseGame;
