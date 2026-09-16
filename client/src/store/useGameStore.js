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
  avatar: localStorage.getItem('domino_avatar') || '🎲',

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
  roomMessages: [],
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
  showProfileSetup: false,

  spectating: null,
  liveGames: [],
  epicMoment: null,
  invitedCode: '',

  // Acciones / Modificadores
  setName: (name) => {
    try {
      if (name) localStorage.setItem('domino_username', name);
    } catch (e) {}
    set({ name });
  },
  setAvatar: (avatar) => {
    try {
      if (avatar) localStorage.setItem('domino_avatar', avatar);
    } catch (e) {}
    set({ avatar });
  },
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
  setShowProfileSetup: (showProfileSetup) => set({ showProfileSetup }),

  setSpectating: (spectating) => set({ spectating }),
  setLiveGames: (liveGames) => set({ liveGames }),
  setEpicMoment: (epicMoment) => set({ epicMoment }),
  setInvitedCode: (invitedCode) => set({ invitedCode }),

  addRoomMessage: (msg) => set((s) => ({ roomMessages: [...s.roomMessages.slice(-49), msg] })),
  clearRoomMessages: () => set({ roomMessages: [] }),
  resetPowerState: () => set({
    selectedPower: null,
    pendingTargetType: null,
    smuggleTileIdx: null
  })
}));

function utf8ToBase64(str) {
  try {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
      return String.fromCharCode(parseInt(p1, 16));
    }));
  } catch {
    return btoa(str);
  }
}

function base64ToUtf8(b64) {
  try {
    const bin = atob(b64);
    const esc = Array.prototype.map.call(bin, (c) => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join('');
    return decodeURIComponent(esc);
  } catch {
    return atob(b64);
  }
}

// Exporta la clave de cuenta como string seguro para transferir o guardar
export function exportAccountKey() {
  const pid = localStorage.getItem('domino_persistent_player_id') || useGameStore.getState().cuentaId;
  const token = localStorage.getItem('domino_session_token') || '';
  const name = localStorage.getItem('domino_username') || useGameStore.getState().name || '';
  const avatar = localStorage.getItem('domino_avatar') || useGameStore.getState().avatar || '🎲';

  if (!pid) return '';
  const payload = JSON.stringify({ pid, token, name, avatar, t: Date.now() });
  try {
    return '2MINO-' + utf8ToBase64(payload).replace(/=/g, '');
  } catch (e) {
    return '';
  }
}

// Importa una clave de cuenta y restaura las credenciales locales
export function importAccountKey(key) {
  if (!key || typeof key !== 'string') return { success: false, error: 'invalid_key' };
  const clean = key.trim();
  const raw = clean.startsWith('2MINO-') ? clean.slice(6) : clean;
  try {
    const pad = raw.length % 4;
    const padded = pad ? raw + '='.repeat(4 - pad) : raw;
    const jsonStr = base64ToUtf8(padded);
    const data = JSON.parse(jsonStr);
    if (!data.pid || !data.pid.startsWith('p_')) {
      return { success: false, error: 'invalid_format' };
    }
    // Guardar en localStorage
    localStorage.setItem('domino_persistent_player_id', data.pid);
    if (data.token) localStorage.setItem('domino_session_token', data.token);
    if (data.name) localStorage.setItem('domino_username', data.name);
    if (data.avatar) localStorage.setItem('domino_avatar', data.avatar);

    // Actualizar useGameStore
    useGameStore.setState({
      cuentaId: data.pid,
      playerId: data.pid,
      name: data.name || useGameStore.getState().name,
      avatar: data.avatar || useGameStore.getState().avatar
    });

    return { success: true, data };
  } catch (e) {
    return { success: false, error: 'corrupt_key' };
  }
}
