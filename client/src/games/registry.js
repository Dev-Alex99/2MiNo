/**
 * Registro dinámico de juegos en el Frontend
 * Mapea IDs de juego con sus componentes y metadatos visuales.
 */
class ClientGameRegistry {
  constructor() {
    this.games = new Map();
  }

  register(gameId, definition) {
    this.games.set(gameId, {
      id: gameId,
      name: definition.name,
      component: definition.component,
      lobbyComponent: definition.lobbyComponent,
      icon: definition.icon || '🎮',
      metadata: definition.metadata || {}
    });
  }

  get(gameId) {
    return this.games.get(gameId) || null;
  }

  list() {
    return Array.from(this.games.values());
  }
}

export const gameRegistry = new ClientGameRegistry();

// Registro por defecto del juego de Dominó
gameRegistry.register('domino', {
  name: 'Dominó Online',
  icon: '🀁',
  metadata: {
    variants: ['Doble 6', 'Doble 9'],
    modes: ['Clásico', 'Cartas de Poder', 'Parejas (2v2)', 'Clasificatorio (Ranked)']
  }
});
