import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { render, resetStores, setGameStore, setHubStore, partidaDePrueba } from '../test/utils';

const socket = globalThis.__socket;

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
  beforeEach(() => resetStores());

  it('el handshake `hello` sale al conectar, con el token guardado', () => {
    localStorage.setItem('domino_session_token', 'v2.999.abc');
    render(<App />);
    act(() => socket.recibir('connect'));

    const hello = socket.ultimoEmitido('hello');
    expect(hello).toBeTruthy();
    expect(hello.token).toBe('v2.999.abc');
    expect(hello.playerId).toBeTruthy();
  });

  it('guarda el token que emite el servidor en `session`', () => {
    render(<App />);
    act(() => socket.recibir('session', { playerId: 'p_test', token: 'v2.123.xyz', authed: true }));
    expect(localStorage.getItem('domino_session_token')).toBe('v2.123.xyz');
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
