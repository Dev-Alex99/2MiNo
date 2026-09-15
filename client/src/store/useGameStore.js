import { create } from 'zustand';

export function getOrCreatePersistentPlayerId() {
  let pid = localStorage.getItem('domino_persistent_player_id');
  if (!pid) {
    pid = 'p_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).slice(-4);
    try { localStorage.setItem('domino_persistent_player_id', pid); } catch (e) {}
  }
  return pid;
}

// Se lee UNA sola vez: las dos identidades arrancan del mismo id y llamar dos
// veces daría pie a creerlas independientes cuando hoy no lo son.
const idDeCuenta = getOrCreatePersistentPlayerId();

export const useGameStore = create((set) => ({
  // Usuario y Conexión
  name: localStorage.getItem('domino_username') || '',

  // ─── LAS DOS IDENTIDADES ───
  // Son dos cosas distintas y por eso son dos campos distintos. Guardarlas en
  // una sola variable es lo que hace que la voz abra un par contra uno mismo:
  // el servidor indexa las llamadas por CUENTA y el cliente le entregaba el
  // ALIAS de asiento, así que la comparación «este miembro no soy yo» daba
  // cierto también para uno mismo.
  //
  //   cuentaId  la PERSONA. `p_xxxx`, persistente en localStorage. Es a quien
  //             se llama, y lo que indexan la voz, el carril de gente, lo
  //             social, la tienda y el perfil: por eso las monedas, el ELO y
  //             las estadísticas que se ganan jugando se acreditan al mismo
  //             usuario que luego lee la tienda y el ranking. NO cambia al
  //             entrar ni al salir de una sala; sólo lo reconcilia `session`.
  //   playerId  el ASIENTO. Lo escribe el servidor al entrar en una sala
  //             (`room_created` / `room_joined`) y lo vacía `handleLeaveRoom`.
  //             Lo leen la sala de espera, la partida, la rejilla de vídeo y la
  //             cinta de turno. El id de cuenta no vuelve a salir de la sala:
  //             para eso existe el alias.
  //
  // `playerId` arranca con el id de cuenta —y no con '', que sería el valor
  // honesto fuera de una sala— A PROPÓSITO: hay 141 referencias no-test y el
  // proveedor de voz todavía lo consume. Cambiar el valor inicial es un cambio
  // de significado, no un cambio de campo, y no cabe en este paquete.
  cuentaId: idDeCuenta,
  playerId: idDeCuenta,
  roomId: sessionStorage.getItem('domino_room_id') || '',
  isConnected: false,

  // Lo que ESTE servidor sabe hacer, tal y como lo anuncia `session`. Los
  // valores por defecto son los de un servidor completo A PROPÓSITO: un
  // servidor viejo no manda `capacidades`, y degradar la interfaz por su
  // silencio apagaría amigos, tienda y perfil en un servidor que sí los tiene.
  // `turnMode` es CADENA ('cloudflare' | 'custom' | 'free-fallback'), nunca un
  // booleano: el copy de la retransmisión ramifica por él.
  capacidades: { persistencia: true, turnMode: 'free-fallback', amigos: true },

  // La sala guardada que el servidor ya no conoce: el código que falló, '' si
  // no hay ninguna. Es una bandera CON dato —`if (salaFantasma)` sigue
  // valiendo— para que la banda del hub pueda ofrecer [Reintentar] con el
  // código, ya borrado de sessionStorage.
  salaFantasma: '',
  // El `session` llegó sin vincular el socket (base de datos caída, identidad
  // ya reclamada, handshake fallido). Se puede jugar y hablar; amigos, monedas
  // y ELO no. Hasta ahora este modo no tenía ni un solo síntoma en pantalla.
  sesionNoVerificada: false,

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
  setCuentaId: (cuentaId) => set({ cuentaId }),
  setPlayerId: (playerId) => set({ playerId }),
  setCapacidades: (capacidades) => set({ capacidades }),
  setSalaFantasma: (salaFantasma) => set({ salaFantasma }),
  setSesionNoVerificada: (sesionNoVerificada) => set({ sesionNoVerificada }),
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
