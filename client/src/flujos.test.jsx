import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useHubStore } from './hub/stores/useHubStore';
import { render, resetStores, setGameStore, setHubStore } from './test/utils';

const socket = globalThis.__socket;

/**
 * Flujos de punta a punta del hub multijuego.
 *
 * Existe por un fallo concreto: pulsar "Tres en Raya" en el hub te metía en el
 * dominó. El id del juego se fijaba bien, pero de ahí en adelante TODO asumía
 * dominó — el lobby, las listas de salas, la clasificatoria y los torneos— y el
 * `gameType` sólo llegaba al servidor al crear la sala.
 */

function salaTicTacToe(extra = {}) {
  return {
    gameType: 'tictactoe',
    roomId: 'ABCD',
    status: 'waiting',
    maxPlayers: 2,
    hostId: 'p_test',
    board: Array(9).fill(null),
    players: [{ id: 'p_test', name: 'Yo', isBot: false, ready: false, score: 0 }],
    ...extra
  };
}

describe('Flujo hub → juego', () => {
  beforeEach(() => resetStores());

  it('elegir un juego en el hub deja el lobby DE ESE juego, no el del dominó', async () => {
    const usuario = userEvent.setup();
    render(<App />);

    await usuario.click(screen.getByText('Tres en Raya'));

    expect(useHubStore.getState().selectedGameId).toBe('tictactoe');
    // El título del lobby es el del juego elegido.
    expect(screen.getByRole('heading', { name: /Tres en Raya/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Domin/i })).toBeNull();
  });

  it('el lobby del dominó sí muestra su nombre', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(screen.getByText('Dominó Online'));
    expect(screen.getByRole('heading', { name: /Dominó Online/i })).toBeInTheDocument();
  });

  /**
   * Las opciones (variante doble 6/9, parejas, poderes, blitz) son del dominó.
   * Ofrecerlas en otro juego era engañoso: se mandaban y el servidor las ignora.
   */
  it('las opciones de sala sólo salen en los juegos que las tienen', async () => {
    const usuario = userEvent.setup();
    render(<App />);

    await usuario.click(screen.getByText('Dominó Online'));
    expect(document.querySelector('.options-summary')).toBeInTheDocument();

    act(() => setHubStore({ selectedGameId: 'tictactoe' }));
    expect(document.querySelector('.options-summary')).toBeNull();
  });

  /**
   * En el servidor la cola por ELO y los torneos hacen `new DominoGame`: desde
   * el tres en raya esos botones te metían literalmente en otro juego.
   */
  it('clasificatoria y torneo no se ofrecen en juegos que no los soportan', () => {
    setHubStore({ selectedGameId: 'domino' });
    const { rerender } = render(<App />);
    expect(document.querySelector('.ranked-find-btn')).toBeInTheDocument();
    expect(document.querySelector('.tournament-btn-highlight')).toBeInTheDocument();

    act(() => setHubStore({ selectedGameId: 'tictactoe' }));
    rerender(<App />);
    expect(document.querySelector('.ranked-find-btn')).toBeNull();
    expect(document.querySelector('.tournament-btn-highlight')).toBeNull();
  });
});

describe('Flujo lobby → listas de salas', () => {
  beforeEach(() => resetStores());

  /**
   * `publicRoomsList(gameTypeFilter)` aceptaba el filtro desde siempre y nunca
   * se le pasaba: el lobby del tres en raya listaba salas de dominó.
   */
  it('se pide el listado DEL juego elegido', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    act(() => socket.recibir('connect'));

    await usuario.click(screen.getByText('Tres en Raya'));
    expect(socket.ultimoEmitido('lobby_subscribe')).toEqual({ gameType: 'tictactoe' });
  });

  it('cambiar de juego vuelve a suscribirse al listado correcto', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    act(() => socket.recibir('connect'));

    await usuario.click(screen.getByText('Tres en Raya'));
    act(() => useHubStore.getState().returnToHub());
    await usuario.click(screen.getByText('Dominó Online'));

    expect(socket.ultimoEmitido('lobby_subscribe')).toEqual({ gameType: 'domino' });
  });
});

describe('Flujo crear sala', () => {
  beforeEach(() => resetStores());

  it('la sala se crea con el juego elegido', async () => {
    const usuario = userEvent.setup();
    setGameStore({ name: 'Ana' });
    render(<App />);

    await usuario.click(screen.getByText('Tres en Raya'));
    await usuario.click(screen.getByRole('button', { name: /Crear Nueva Sala/i }));

    expect(socket.ultimoEmitido('create_room').gameType).toBe('tictactoe');
  });
});

describe('Flujo entrar en una sala de otro juego', () => {
  beforeEach(() => resetStores());

  /**
   * Por enlace de invitación, código de un amigo o reconexión puedes acabar en
   * una sala de un juego distinto al elegido. Si el hub no se entera, al salir
   * de la partida vuelves al lobby equivocado.
   */
  it('el juego seleccionado se sincroniza con la partida en curso', () => {
    setHubStore({ selectedGameId: 'domino' });
    render(<App />);

    act(() => setGameStore({ roomId: 'ABCD', gameState: salaTicTacToe() }));

    expect(useHubStore.getState().selectedGameId).toBe('tictactoe');
  });

  it('la sala de espera no anuncia modalidades de dominó en otro juego', () => {
    setHubStore({ selectedGameId: 'tictactoe' });
    setGameStore({ roomId: 'ABCD', gameState: salaTicTacToe() });
    render(<App />);

    const etiquetas = document.querySelector('.room-mode-tags');
    expect(etiquetas).toBeInTheDocument();
    expect(etiquetas.textContent).not.toMatch(/Doble/i);
    expect(etiquetas.textContent).not.toMatch(/puntos/i);
    expect(etiquetas.textContent).toMatch(/Tres en Raya/);
  });

  /**
   * La mesa se pintaba SIEMPRE de cuatro: tres ranuras vacías en una sala de
   * tres en raya (2 plazas), contador "1/4" —el 4 estaba dentro de la propia
   * traducción— y el botón de añadir bot activo con la sala ya llena.
   */
  it('la sala de espera muestra el aforo REAL del juego, no cuatro plazas', () => {
    setHubStore({ selectedGameId: 'tictactoe' });
    setGameStore({ roomId: 'ABCD', gameState: salaTicTacToe() });
    render(<App />);

    // 1 sentado + 1 hueco = 2 plazas, no 4.
    expect(document.querySelectorAll('.player-row-empty')).toHaveLength(1);
    expect(document.querySelector('.waiting-players-header').textContent).toMatch(/1\/2/);
    expect(document.querySelector('.waiting-players-header').textContent).not.toMatch(/\/4/);
  });

  it('con la mesa llena no se puede añadir otro bot', () => {
    setHubStore({ selectedGameId: 'tictactoe' });
    setGameStore({
      roomId: 'ABCD',
      gameState: salaTicTacToe({
        players: [
          { id: 'p_test', name: 'Yo', isBot: false, ready: false, score: 0 },
          { id: 'p_bot', name: 'Bot', isBot: true, ready: true, score: 0 }
        ]
      })
    });
    render(<App />);

    expect(document.querySelectorAll('.player-row-empty')).toHaveLength(0);
    expect(document.querySelector('.bot-add-btn')).toBeDisabled();
  });

  it('el dominó conserva sus cuatro plazas', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({
      roomId: 'WXYZ',
      gameState: {
        gameType: 'domino', roomId: 'WXYZ', status: 'waiting', maxPlayers: 4,
        maxPip: 6, maxScore: 100, powersEnabled: false, teamsEnabled: false,
        hostId: 'p_test', board: [],
        players: [{ id: 'p_test', name: 'Yo', isBot: false, ready: false, score: 0, hand: [] }]
      }
    });
    render(<App />);
    expect(document.querySelectorAll('.player-row-empty')).toHaveLength(3);
    expect(document.querySelector('.waiting-players-header').textContent).toMatch(/1\/4/);
  });

  it('en dominó sí las anuncia', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({
      roomId: 'WXYZ',
      gameState: {
        gameType: 'domino', roomId: 'WXYZ', status: 'waiting', maxPlayers: 4,
        maxPip: 6, maxScore: 100, powersEnabled: false, teamsEnabled: false,
        hostId: 'p_test', board: [],
        players: [{ id: 'p_test', name: 'Yo', isBot: false, ready: false, score: 0, hand: [] }]
      }
    });
    render(<App />);
    expect(document.querySelector('.room-mode-tags').textContent).toMatch(/Doble/i);
  });
});
