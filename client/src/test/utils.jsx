import React from 'react';
import { render as rtlRender } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import { useGameStore } from '../store/useGameStore';
import { useHubStore } from '../hub/stores/useHubStore';

/**
 * Render envuelto en el provider de idioma, como en `main.jsx`.
 *
 * Fija el idioma a español: `detectLang()` mira `navigator.language`, que en
 * jsdom es en-US, así que sin esto los tests compararían contra los textos en
 * inglés según el entorno. Con el idioma fijado son deterministas.
 */
export function render(ui, options) {
  localStorage.setItem('domino_lang', 'es');
  return rtlRender(ui, { wrapper: ({ children }) => <LanguageProvider>{children}</LanguageProvider>, ...options });
}

/** Estado inicial de los stores, para que un test no contamine al siguiente. */
const ESTADO_LIMPIO = {
  name: '',
  playerId: 'p_test',
  roomId: '',
  isConnected: false,
  gameState: null,
  error: '',
  selectedTileIndex: null,
  quickNotifications: [],
  publicRooms: [],
  roomsLoading: true,
  lobbyStats: null,
  showTurnBanner: false,
  selectedPower: null,
  pendingTargetType: null,
  smuggleTileIdx: null,
  showProfile: false,
  spectating: null,
  liveGames: [],
  epicMoment: null,
  invitedCode: ''
};

export function resetStores() {
  useGameStore.setState(ESTADO_LIMPIO);
  useHubStore.setState({ selectedGameId: null });
}

export function setGameStore(parcial) {
  useGameStore.setState(parcial);
}

export function setHubStore(parcial) {
  useHubStore.setState(parcial);
}

/**
 * Estado de partida mínimo pero completo: lo que el servidor manda en
 * `game_state` y de lo que dependen tablero, mano, asientos y barra.
 */
export function partidaDePrueba(extra = {}) {
  return {
    roomId: 'ABCD',
    gameType: 'domino',
    status: 'playing',
    players: [
      { id: 'p_test', name: 'Yo', hand: [[6, 6], [3, 4]], handCount: 2, score: 0, powers: [], ready: true, isBot: false },
      { id: 'p_rival', name: 'Rival', hand: [], handCount: 5, score: 0, powers: [], ready: true, isBot: true }
    ],
    board: [[6, 3], [3, 5]],
    currentPlayerId: 'p_test',
    boneyardCount: 4,
    roundNumber: 1,
    maxScore: 100,
    teamsEnabled: false,
    powersEnabled: false,
    drawEnabled: true,
    activeEffects: {},
    moveLog: [],
    teamScores: [0, 0],
    ...extra
  };
}
