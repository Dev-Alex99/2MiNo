import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import App from './App';
import { render, resetStores, setGameStore, setHubStore, partidaDePrueba } from './test/utils';

const socket = globalThis.__socket;

/**
 * Cobertura del router de vistas de App.
 *
 * Existe por A-7: App pasó de 977 líneas a 281 repartiendo el trabajo en
 * `useGameSocket`, `useGameActions` y `GameView`. Ese refactor se verificó
 * comparando el tráfico de socket antes/después, pero nada comprobaba que cada
 * rama del router siguiera pintando lo que debía. Esto lo comprueba.
 */
describe('App · router de vistas', () => {
  beforeEach(() => resetStores());

  it('sin juego seleccionado muestra el hub', () => {
    render(<App />);
    expect(document.querySelector('.app-container.spectator')).toBeNull();
    // El hub lista los juegos disponibles.
    expect(screen.getByText('Dominó Online')).toBeInTheDocument();
    expect(screen.getByText('Tres en Raya')).toBeInTheDocument();
  });

  it('con juego seleccionado y sin sala muestra el lobby', () => {
    setHubStore({ selectedGameId: 'domino' });
    render(<App />);
    // El lobby pide nombre y código de sala.
    expect(screen.getByPlaceholderText(/Ej\. Alejandro/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ABCD/i)).toBeInTheDocument();
  });

  it('en una sala en espera muestra la sala de espera, no el tablero', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({
      roomId: 'ABCD',
      gameState: partidaDePrueba({ status: 'waiting' })
    });
    render(<App />);
    // Código de sala visible para invitar; sin tablero todavía.
    expect(screen.getByText('ABCD')).toBeInTheDocument();
    expect(document.querySelector('.game-area')).toBeNull();
  });

  it('en partida muestra el tablero y la mano', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    render(<App />);
    expect(document.querySelector('.game-area')).toBeInTheDocument();
    expect(document.querySelector('.board-region')).toBeInTheDocument();
  });

  it('espectando muestra la vista de espectador y ninguna otra', () => {
    setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) });
    render(<App />);
    expect(document.querySelector('.app-container.spectator')).toBeInTheDocument();
    // La vista de espectador sustituye TODO: no debe quedar hub debajo.
    expect(screen.queryByText('Tres en Raya')).toBeNull();
  });

  it('entrar y salir de espectador no rompe el orden de hooks (regresión C-4)', () => {
    setHubStore({ selectedGameId: 'domino' });
    const { rerender } = render(<App />);

    // Entrar a espectador: cambia la rama de return de App.
    act(() => setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) }));
    rerender(<App />);
    expect(document.querySelector('.app-container.spectator')).toBeInTheDocument();

    // Y salir. Si algún hook se llamara después del return condicional, React
    // reventaría aquí con "Rendered fewer hooks than expected".
    act(() => setGameStore({ spectating: null, gameState: null }));
    rerender(<App />);
    expect(document.querySelector('.app-container.spectator')).toBeNull();
  });

  it('con torneo activo el cuadro manda sobre el hub y el lobby', () => {
    setHubStore({ selectedGameId: 'domino' });
    render(<App />);
    act(() => socket.recibir('tournament_state', {
      id: 't1', code: 'TRN1', status: 'lobby',
      players: [{ id: 'p_test', name: 'Yo' }],
      matches: []
    }));
    expect(screen.queryByText('Tres en Raya')).toBeNull();
    expect(screen.getByText('TRN1')).toBeInTheDocument();
  });
});

describe('App · avisos globales', () => {
  beforeEach(() => resetStores());

  it('el aviso de conexión perdida se ve en el hub, no sólo en partida (regresión M6)', () => {
    render(<App />);
    expect(document.querySelector('.network-alert')).toBeInTheDocument();

    act(() => socket.recibir('connect'));
    expect(document.querySelector('.network-alert')).toBeNull();
  });

  it('un error del servidor se ve en el hub y se traduce', () => {
    render(<App />);
    act(() => socket.recibir('error_msg', { key: 'srv.err.roomNotFound' }));

    const toast = document.querySelector('.error-toast');
    expect(toast).toBeInTheDocument();
    // Traducido, no la clave cruda.
    expect(toast.textContent).not.toContain('srv.err.');
  });
});
