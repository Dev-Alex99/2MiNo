import { create } from 'zustand';

export function getOrCreatePersistentPlayerId() {
  let pid = localStorage.getItem('domino_persistent_player_id');
  if (!pid) {
    pid = 'p_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).slice(-4);
    try { localStorage.setItem('domino_persistent_player_id', pid); } catch (e) {}
  }
  return pid;
}

export const useGameStore = create((set) => ({
  // Usuario y Conexión
  name: localStorage.getItem('domino_username') || '',
  playerId: sessionStorage.getItem('domino_player_id') || getOrCreatePersistentPlayerId(),
  roomId: sessionStorage.getItem('domino_room_id') || '',
  isConnected: false,

  // Estado del juego y salas
  gameState: null,
  error: '',
  selectedTileIndex: null,
  quickNotifications: [],
  publicRooms: [],
  roomsLoading: true,
  lobbyStats: null,
  showTurnBanner: false,

  // Cartas de poderes
  selectedPower: null,
  pendingTargetType: null,
  smuggleTileIdx: null,

  // Modales y Vistas
  showProfile: false,

  spectating: null,
  liveGames: [],
  epicMoment: null,
  invitedCode: '',

  // Acciones / Modificadores
  setName: (name) => set({ name }),
  setPlayerId: (playerId) => set({ playerId }),
  setRoomId: (roomId) => set({ roomId }),
  setIsConnected: (isConnected) => set({ isConnected }),
  setGameState: (gameState) => set({ gameState }),
  setError: (error) => set({ error }),
  setSelectedTileIndex: (selectedTileIndex) => set({ selectedTileIndex }),
  setQuickNotifications: (fnOrVal) => set((state) => ({
    quickNotifications: typeof fnOrVal === 'function' ? fnOrVal(state.quickNotifications) : fnOrVal
  })),
  setPublicRooms: (publicRooms) => set({ publicRooms }),
  setRoomsLoading: (roomsLoading) => set({ roomsLoading }),
  setLobbyStats: (lobbyStats) => set({ lobbyStats }),
  setShowTurnBanner: (showTurnBanner) => set({ showTurnBanner }),
  setSelectedPower: (selectedPower) => set({ selectedPower }),
  setPendingTargetType: (pendingTargetType) => set({ pendingTargetType }),
  setSmuggleTileIdx: (smuggleTileIdx) => set({ smuggleTileIdx }),
  setShowProfile: (showProfile) => set({ showProfile }),

  setSpectating: (spectating) => set({ spectating }),
  setLiveGames: (liveGames) => set({ liveGames }),
  setEpicMoment: (epicMoment) => set({ epicMoment }),
  setInvitedCode: (invitedCode) => set({ invitedCode }),

  resetPowerState: () => set({
    selectedPower: null,
    pendingTargetType: null,
    smuggleTileIdx: null
  })
}));
