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
    // Aforo de la mesa. Cada juego lo ajusta; `roomHandler` los consulta en vez
    // de asumir 4 (que era lo que dejaba entrar a un tercero en un 1v1).
    this.minPlayers = options.minPlayers || 2;
    this.maxPlayers = options.maxPlayers || 4;
    // Anfitrión: quien puede expulsar. Sin esto, `game.hostId` era undefined y
    // expulsar fallaba siempre con "solo el anfitrión puede".
    this.hostId = null;
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
  handleAction(_playerId, _actionType, _payload) {
    throw new Error(`El juego '${this.gameType}' no implementa handleAction()`);
  }

  /** Devuelve el estado compartido del juego (sin filtros) */
  getSharedState() {
    throw new Error(`El juego '${this.gameType}' no implementa getSharedState()`);
  }

  /** Devuelve el estado filtrado para un jugador específico (niebla de guerra/mano propia) */
  getGameStateForPlayer(_playerId, _sharedState) {
    throw new Error(`El juego '${this.gameType}' no implementa getGameStateForPlayer()`);
  }

  /** Devuelve el estado filtrado para un espectador */
  getSpectatorState(_sharedState) {
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
  addBot(_name, _difficulty) {
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
    this.ensureHost();
    return player;
  }

  removePlayer(socketId) {
    const idx = this.players.findIndex(p => p.socketId === socketId);
    if (idx !== -1) {
      const removed = this.players.splice(idx, 1)[0];
      this.ensureHost();
      return removed;
    }
    return null;
  }

  hasHumans() {
    return this.players.some(p => !p.isBot && p.socketId !== null);
  }

  // ─── Ciclo de vida de la SALA (común a todos los juegos) ───
  //
  // Esto vivía sólo en DominoGame, pero `roomHandler` lo llama en CUALQUIER
  // sala. Resultado: en una partida de tres en raya, `toggle_ready` lanzaba
  // `game.toggleReady is not a function` y dos humanos NUNCA podían empezar;
  // `add_bot`, `remove_bot`, `swap_seats`, expulsar y abandonar reventaban
  // igual. Son operaciones sobre ASIENTOS, no sobre reglas, así que su sitio es
  // aquí. Un juego con necesidades propias (el dominó reasigna parejas) las
  // sobrescribe.

  toggleReady(socketId) {
    const player = this.players.find(p => p.socketId === socketId);
    if (player) player.ready = !player.ready;
    return player || null;
  }

  /** ¿Puede arrancar la partida? Mesa con gente suficiente y todos listos. */
  allReady() {
    return this.players.length >= this.minPlayers && this.players.every(p => p.ready);
  }

  removePlayerById(id) {
    const index = this.players.findIndex(p => p.id === id);
    if (index === -1) return null;
    const removed = this.players.splice(index, 1)[0];
    this.ensureHost(); // si se fue el anfitrión, lo hereda otro humano
    return removed;
  }

  /** El anfitrión debe ser siempre un humano presente. */
  ensureHost() {
    const current = this.players.find(p => p.id === this.hostId);
    if (current && !current.isBot) return;
    const human = this.players.find(p => !p.isBot);
    this.hostId = human ? human.id : null;
  }

  // ─── Resultado de la partida (para el historial y el ELO) ───
  //
  // El orquestador leía `game.gameWinner` y `game.maxPip` directamente, que son
  // campos del DOMINÓ. Con otro juego eso registraba basura: una partida de tres
  // en raya se guardaba como `double_6` y siempre como empate, porque su ganador
  // no vive en `gameWinner` sino en `winner` (un símbolo, no un playerId).

  /** Id del jugador ganador, 'tie' en empate, o null si no aplica. */
  getWinnerId() {
    return this.gameWinner || null;
  }

  /** Etiqueta de la modalidad para el historial de partidas. */
  getVariantLabel() {
    return this.gameType;
  }

  swapSeats(idA, idB) {
    if (this.status !== 'waiting') return false;
    if (idA === idB) return false;

    const a = this.players.findIndex(p => p.id === idA);
    const b = this.players.findIndex(p => p.id === idB);
    if (a === -1 || b === -1) return false;

    [this.players[a], this.players[b]] = [this.players[b], this.players[a]];
    return true;
  }
}

module.exports = BaseGame;
