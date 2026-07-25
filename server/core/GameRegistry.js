/**
 * GameRegistry
 * Registro central de motores de juegos del servidor.
 */
class GameRegistry {
  constructor() {
    this.games = new Map();
  }

  /**
   * Registra una clase de juego en el Hub.
   * @param {string} gameType Identificador único del juego (ej. 'domino', 'ludo')
   * @param {Class} GameClass Subclase de BaseGame
   * @param {Object} metadata Metadata del juego (nombre, min/max jugadores, etc.)
   */
  register(gameType, GameClass, metadata = {}) {
    this.games.set(gameType, {
      gameType,
      GameClass,
      metadata: {
        name: metadata.name || gameType,
        minPlayers: metadata.minPlayers || 2,
        maxPlayers: metadata.maxPlayers || 4,
        description: metadata.description || '',
        ...metadata
      }
    });
    console.log(`[GameRegistry] Juego registrado: '${gameType}' (${metadata.name || gameType})`);
  }

  /** Obtiene la definición de un juego por su tipo */
  get(gameType) {
    return this.games.get(gameType) || null;
  }

  /** Instancia una nueva partida del tipo especificado */
  createGameInstance(gameType, roomId, options = {}) {
    const entry = this.get(gameType);
    if (!entry) {
      throw new Error(`[GameRegistry] Juego no soportado: '${gameType}'`);
    }
    const { GameClass } = entry;
    return new GameClass(roomId, options);
  }

  /** Devuelve la lista de juegos disponibles en el servidor */
  listGames() {
    const list = [];
    for (const [gameType, entry] of this.games.entries()) {
      list.push({
        gameType,
        ...entry.metadata
      });
    }
    return list;
  }
}

const registryInstance = new GameRegistry();
module.exports = registryInstance;
