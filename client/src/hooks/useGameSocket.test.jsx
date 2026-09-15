import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import useGameSocket from './useGameSocket';
import { useGameStore } from '../store/useGameStore';
import { render, resetStores, setGameStore, setHubStore, partidaDePrueba } from '../test/utils';

const socket = globalThis.__socket;

// Sonda mínima para lo que el hook DEVUELVE (montar `App` no da acceso a ello).
let red;
function SondaRed() {
  const invitedCodeRef = React.useRef('');
  red = useGameSocket({ invitedCodeRef });
  return null;
}

// Los 21 eventos que la app debe escuchar. Si alguien añade un listener y olvida
// su `off`, o al revés, este listado lo delata.
const EVENTOS = [
  'connect', 'disconnect', 'session', 'room_created', 'room_joined', 'game_state',
  'play_sound', 'receive_quick_message', 'error_msg', 'rooms_list', 'live_games',
  'lobby_stats', 'kicked', 'spectating', 'room_closed', 'profile_data',
  'tournament_state', 'tournament_error', 'match_found', 'friend_invited',
  'friend_incoming'
].sort();

describe('useGameSocket · registro de listeners', () => {
  beforeEach(() => resetStores());

  it('registra los 21 eventos esperados', () => {
    render(<App />);
    const escuchados = socket.eventosEscuchados();
    // Subconjunto: la capa de voz registra los suyos aparte, sobre el mismo socket.
    for (const evento of EVENTOS) {
      expect(escuchados, `falta el listener de '${evento}'`).toContain(evento);
    }
  });

  it('al desmontar no queda NINGÚN listener colgado (ni de juego ni de voz)', () => {
    const { unmount } = render(<App />);
    expect(socket.eventosEscuchados().length).toBeGreaterThanOrEqual(EVENTOS.length);
    unmount();
    expect(socket.eventosEscuchados()).toEqual([]);
  });

  it('cada evento tiene UN solo listener, también tras re-renderizar', () => {
    const { rerender } = render(<App />);
    act(() => setGameStore({ isConnected: true, roomsLoading: false }));
    rerender(<App />);
    act(() => socket.recibir('lobby_stats', { online: 3, playing: 1, openRooms: 2 }));
    rerender(<App />);

    for (const evento of EVENTOS) {
      expect(socket.listeners(evento), `evento ${evento}`).toBe(1);
    }
  });

  /**
   * Regresión A-6. El efecto llegó a depender de `t`, así que cada cambio de
   * idioma desmontaba y volvía a montar los ~21 listeners y re-invocaba
   * `connect()`, con ventana para perder eventos entrantes. Hoy el array de
   * dependencias es un único ref.
   */
  it('cambiar de idioma NO vuelve a registrar los listeners ni reconecta', async () => {
    const usuario = userEvent.setup();
    setHubStore({ selectedGameId: 'domino' });
    render(<App />); // el lobby ya trae su propio selector de idioma

    const hellosAntes = socket.emitidos('hello').length;
    for (const evento of EVENTOS) expect(socket.listeners(evento)).toBe(1);

    // Cambiar de idioma con el selector real: abrir el desplegable y elegir.
    await usuario.click(screen.getAllByTitle('Idioma / Language')[0]);
    const opciones = screen.getAllByRole('option');
    const ingles = opciones.find(o => /english/i.test(o.textContent));
    await usuario.click(ingles);

    // El idioma ha cambiado de verdad (si no, el test no probaría nada).
    expect(localStorage.getItem('domino_lang')).toBe('en');

    for (const evento of EVENTOS) {
      expect(socket.listeners(evento), `evento ${evento} tras cambiar idioma`).toBe(1);
    }
    // Y no se ha vuelto a hacer el handshake: señal de que no hubo reconexión.
    expect(socket.emitidos('hello').length).toBe(hellosAntes);
  });
});

describe('useGameSocket · handlers', () => {
  // `ESTADO_LIMPIO` de test/utils.jsx todavía no declara las dos banderas
  // nuevas, y `setState` de zustand MEZCLA: sin apagarlas aquí, la que enciende
  // un caso se cuela en el siguiente y el orden de los tests pasa a importar.
  beforeEach(() => {
    resetStores();
    setGameStore({ salaFantasma: '', sesionNoVerificada: false });
  });

  it('el handshake `hello` sale al conectar, con el token guardado', () => {
    localStorage.setItem('domino_session_token', 'v2.999.abc');
    render(<App />);
    act(() => socket.recibir('connect'));

    const hello = socket.ultimoEmitido('hello');
    expect(hello).toBeTruthy();
    expect(hello.token).toBe('v2.999.abc');
    expect(hello.playerId).toBeTruthy();
  });

  /**
   * El reenganche de la voz. El servidor liga la sesión de voz al id de la
   * PESTAÑA, que cambia en cada reconexión; sin este saludo, una llamada
   * sobrevive a la caída del socket pero nadie vuelve a decirle al cliente
   * dónde estaba. Va pegado al `hello` porque el servidor resuelve la identidad
   * con la promesa que abre el handshake.
   */
  it('cada `hello` va seguido de un `voice_hello`', () => {
    render(<App />);
    socket.limpiarEmitidos();
    act(() => socket.recibir('connect'));

    const orden = socket.emitidos().map(e => e.evento);
    const iHello = orden.indexOf('hello');
    expect(iHello).toBeGreaterThanOrEqual(0);
    expect(orden[iHello + 1]).toBe('voice_hello');
    expect(socket.ultimoEmitido('voice_hello')).toEqual({});
  });

  it('guarda el token que emite el servidor en `session`', () => {
    render(<App />);
    act(() => socket.recibir('session', { playerId: 'p_test', token: 'v2.123.xyz', authed: true }));
    expect(localStorage.getItem('domino_session_token')).toBe('v2.123.xyz');
  });

  /**
   * Las DOS identidades. `session` habla de la PERSONA; el asiento lo escribe
   * la sala. Si el handler tocara `playerId`, el jugador perdería su mano en
   * mitad de una partida cada vez que el servidor renovara el token.
   */
  it('`session` reconcilia la cuenta y guarda las capacidades, sin tocar el asiento', () => {
    render(<App />);
    act(() => socket.recibir('session', {
      playerId: 'p_servidor',
      token: 'v2.1.abc',
      authed: true,
      capacidades: { persistencia: false, turnMode: 'cloudflare', amigos: false }
    }));

    const s = useGameStore.getState();
    expect(s.cuentaId).toBe('p_servidor');
    expect(s.capacidades).toEqual({ persistencia: false, turnMode: 'cloudflare', amigos: false });
    expect(s.playerId).toBe('p_test');
  });

  it('un servidor que anuncia una sola capacidad no apaga las otras', () => {
    render(<App />);
    act(() => socket.recibir('session', {
      playerId: 'p_cuenta', token: 'v2.1.abc', authed: true,
      capacidades: { turnMode: 'custom' }
    }));

    expect(useGameStore.getState().capacidades).toEqual({
      persistencia: true, turnMode: 'custom', amigos: true
    });
  });

  /**
   * El tercer modo, y el peor: `DATABASE_URL` presente pero rota. El socket no
   * queda vinculado, así que el jugador es invisible e inllamable. Hasta ahora
   * el cliente sólo sabía reaccionar a 'reclamada' y este caso no tenía ni un
   * síntoma en pantalla.
   */
  it('una sesión que no se puede verificar enciende el modo invitado', () => {
    // La identidad se acuña PEREZOSAMENTE, en la primera acción que la necesita
    // (crear sala, unirse, torneo), no al arrancar. Así que para comprobar que
    // no se tira hay que partir de una que exista: el aserto anterior era
    // `toBeTruthy()` sobre un almacenamiento recién limpiado y pasaba sólo
    // porque el widget de voz de entonces llamaba a getOrCreatePersistentPlayerId()
    // en el cuerpo del render y acuñaba una identidad NUEVA en cada pintado —o
    // sea, pasaba por lo contrario de lo que afirma—. Retirado ese widget, el
    // aserto se cayó y dejó ver que nunca probó nada.
    localStorage.setItem('domino_persistent_player_id', 'p_mia_de_siempre');
    render(<App />);
    expect(useGameStore.getState().sesionNoVerificada).toBe(false);

    act(() => socket.recibir('session', {
      playerId: null, token: null, authed: false, reason: 'no_disponible'
    }));

    expect(useGameStore.getState().sesionNoVerificada).toBe(true);
    // Y NO se tira la identidad: la del jugador es buena, lo que falla es el
    // servidor. Tirarla le costaría monedas, ELO y amigos por una caída ajena.
    // Se exige la MISMA, no una cualquiera: sustituirla en silencio por otra
    // recién acuñada tendría el mismo coste que borrarla.
    expect(localStorage.getItem('domino_persistent_player_id')).toBe('p_mia_de_siempre');
  });

  /**
   * El [Reintentar] de la franja de modo invitado. Rehace el handshake sin
   * reconectar el socket, y con él el saludo de voz: si sólo repitiera `hello`,
   * el servidor volvería a vincular la identidad pero nadie le pediría el
   * estado de la línea, que es la mitad que importa cuando esto se pulsa.
   */
  it('`reintentarSesion` repite el handshake completo, saludo de voz incluido', () => {
    localStorage.setItem('domino_session_token', 'v2.999.abc');
    render(<SondaRed />);
    socket.limpiarEmitidos();

    act(() => red.reintentarSesion());

    const orden = socket.emitidos().map(e => e.evento);
    expect(orden).toEqual(['hello', 'voice_hello']);
    expect(socket.ultimoEmitido('hello').token).toBe('v2.999.abc');
  });

  it('el modo invitado se apaga en cuanto llega una sesión verificada', () => {
    render(<App />);
    act(() => socket.recibir('session', { authed: false, reason: 'error' }));
    expect(useGameStore.getState().sesionNoVerificada).toBe(true);

    act(() => socket.recibir('session', { playerId: 'p_cuenta', token: 'v2.2.ok', authed: true }));
    expect(useGameStore.getState().sesionNoVerificada).toBe(false);
  });

  /**
   * Con el oráculo de tokens cerrado (C-2), el servidor puede rechazar una
   * identidad ya reclamada. Si el cliente se quedara con ella, perfil, tienda y
   * amigos fallarían en silencio para siempre: debe empezar una identidad nueva.
   */
  it('si el servidor rechaza la identidad, arranca una nueva y reintenta', () => {
    localStorage.setItem('domino_persistent_player_id', 'p_ajeno');
    localStorage.setItem('domino_session_token', 'caducado');
    render(<App />);

    act(() => socket.recibir('session', { playerId: null, token: null, authed: false, reason: 'reclamada' }));

    expect(localStorage.getItem('domino_persistent_player_id')).not.toBe('p_ajeno');
    expect(localStorage.getItem('domino_session_token')).toBeNull();
    // Y vuelve a presentarse con la identidad nueva.
    expect(socket.ultimoEmitido('hello').playerId).not.toBe('p_ajeno');
  });

  it('`room_joined` guarda la sala en sessionStorage para poder reconectar', () => {
    render(<App />);
    act(() => socket.recibir('room_joined', { roomId: 'WXYZ', playerId: 'p_test' }));
    expect(sessionStorage.getItem('domino_room_id')).toBe('WXYZ');
    expect(sessionStorage.getItem('domino_player_id')).toBe('p_test');
  });

  it('entrar en una sala escribe el ASIENTO y deja la cuenta como estaba', () => {
    render(<App />);
    act(() => socket.recibir('room_joined', { roomId: 'WXYZ', playerId: 's_1a2b' }));

    const s = useGameStore.getState();
    expect(s.playerId).toBe('s_1a2b');
    expect(s.cuentaId).toBe('p_cuenta');
  });

  /**
   * LA SALA FANTASMA. `onConnect` reintenta la sala guardada; si el servidor ya
   * no la tiene, hasta ahora nadie borraba lo guardado y el mismo aviso rojo
   * volvía en CADA recarga, para siempre.
   */
  it('la sala guardada que ya no existe se olvida, sin aviso rojo', () => {
    sessionStorage.setItem('domino_room_id', 'ABCD');
    sessionStorage.setItem('domino_player_id', 's_1a2b');
    setGameStore({ roomId: 'ABCD' });
    render(<App />);

    act(() => socket.recibir('error_msg', { key: 'srv.err.roomNotFound' }));

    expect(sessionStorage.getItem('domino_room_id')).toBeNull();
    expect(sessionStorage.getItem('domino_player_id')).toBeNull();

    const s = useGameStore.getState();
    // La bandera lleva el código: la banda del hub necesita poder ofrecer
    // [Reintentar] con algo, y sessionStorage ya está vacío.
    expect(s.salaFantasma).toBe('ABCD');
    // Y el store deja de decir que seguimos dentro de una sala que no existe.
    expect(s.roomId).toBe('');
    expect(document.querySelector('.error-toast')).toBeNull();
  });

  it('un código tecleado que no existe SÍ da su aviso rojo', () => {
    render(<App />);
    act(() => socket.recibir('error_msg', { key: 'srv.err.roomNotFound' }));

    expect(useGameStore.getState().salaFantasma).toBe('');
    expect(document.querySelector('.error-toast')).toBeInTheDocument();
  });

  it('entrar en otra sala retira la banda de la sala fantasma', () => {
    setGameStore({ salaFantasma: 'ABCD' });
    render(<App />);

    act(() => socket.recibir('room_joined', { roomId: 'WXYZ', playerId: 's_9z8y' }));
    expect(useGameStore.getState().salaFantasma).toBe('');
  });

  it('`kicked` saca de la sala y limpia el almacenamiento', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    sessionStorage.setItem('domino_room_id', 'ABCD');
    render(<App />);

    act(() => socket.recibir('kicked', { by: 'Anfitrión' }));

    expect(sessionStorage.getItem('domino_room_id')).toBeNull();
    expect(document.querySelector('.game-area')).toBeNull();
    expect(document.querySelector('.error-toast')).toBeInTheDocument();
  });
});
