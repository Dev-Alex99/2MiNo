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
 *
 * NO envuelve en el proveedor de voz, y es una decisión, no un olvido: el
 * proveedor se queda dentro de `App.jsx`. Envolver aquí obligaría a instanciar
 * el motor de voz —micrófono, pares, temporizadores— en los 223 tests que no
 * tienen nada que ver con la voz. Los que sí la necesitan montan `<App/>` (y lo
 * obtienen solo) o el proveedor a mano.
 */
export function render(ui, options) {
  localStorage.setItem('domino_lang', 'es');
  return rtlRender(ui, { wrapper: ({ children }) => <LanguageProvider>{children}</LanguageProvider>, ...options });
}

/**
 * Estado inicial de los stores, para que un test no contamine al siguiente.
 *
 * LOS DOS ESPACIOS DE IDENTIDAD, con valores DISTINTOS a propósito:
 *
 *   cuentaId  la persona. Es lo que indexan la voz, el carril, lo social, la
 *             tienda y el perfil. No cambia al entrar ni al salir de una sala.
 *   playerId  el asiento. Lo escribe el servidor al entrar en una sala y se
 *             vacía al salir. Es lo que leen la sala de espera, la partida, la
 *             rejilla de vídeo y la cinta de turno.
 *
 * Si los dos valieran lo mismo, un módulo que lea el campo equivocado seguiría
 * pasando todos los tests: por eso `cuentaId` es 'p_cuenta' y no 'p_test'.
 *
 * `playerId` se queda en 'p_test' —y no en '', que sería el valor honesto fuera
 * de una sala— porque es el id que usa `partidaDePrueba()` para el jugador
 * propio y del que dependen los 14 casos de mesa y poderes de `App.test.jsx`.
 * Para el caso "fuera de sala" está `fueraDeSala()`, aquí abajo.
 */
const ESTADO_LIMPIO = {
  name: '',
  cuentaId: 'p_cuenta',
  playerId: 'p_test',
  roomId: '',
  isConnected: false,
  // Lo que anuncia `session`. Por defecto, un servidor completo: quien quiera
  // probar el modo degradado apaga la que le toque.
  capacidades: { persistencia: true, turnMode: 'free-fallback', amigos: true },
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
 * Estado de "no estoy en ninguna sala": sin alias de asiento, sin sala y sin
 * partida. `cuentaId` NO se toca, que es justo lo que hay que poder afirmar.
 */
export function fueraDeSala() {
  useGameStore.setState({ playerId: '', roomId: '', gameState: null, spectating: null });
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
