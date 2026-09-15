import { create } from 'zustand';

/**
 * El estado del hub, que es UNA sola cosa: qué juego estás mirando.
 *
 * Tenía además `availableGames`, una segunda copia del catálogo con cinco
 * entradas escritas a mano (nombre, icono, categoría, descripción, insignia y
 * un `color` con clases de Tailwind en un proyecto sin Tailwind). El catálogo
 * de verdad se compone ahora en `hub/catalogo.js` sobre `games/registry.js`,
 * que es donde vive el tablero de cada juego: un juego con tablero sale en la
 * rejilla y uno sin él, no. Los dos que todavía no existen (Ludo, Ajedrez)
 * están en `catalogo.PROXIMAMENTE` y ya no gastan una tarjeta.
 */
export const useHubStore = create((set) => ({
  // Juego actualmente seleccionado en el Hub (null = Pantalla Principal del Hub)
  selectedGameId: null,

  // Acciones
  setSelectedGameId: (gameId) => set({ selectedGameId: gameId }),
  returnToHub: () => set({ selectedGameId: null })
}));
