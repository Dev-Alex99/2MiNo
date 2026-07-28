import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicTacToeBoard from './TicTacToeBoard';
import SpectatorView from '../../components/SpectatorView';
import { obtenerTablero, obtenerTableroEspectador } from '../registry';
import { render, resetStores } from '../../test/utils';

const socket = globalThis.__socket;

function partida(extra = {}) {
  return {
    gameType: 'tictactoe',
    roomId: 'ABCD',
    status: 'playing',
    board: Array(9).fill(null),
    currentPlayerId: 'p_yo',
    symbols: { p_yo: 'X', p_bot: 'O' },
    winner: null,
    winningLine: null,
    scores: { X: 0, O: 0 },
    roundNumber: 1,
    turnEndsAt: Date.now() + 30000,
    players: [
      { id: 'p_yo', name: 'Yo', isBot: false, score: 0, symbol: 'X' },
      { id: 'p_bot', name: 'Robotín', isBot: true, score: 0, symbol: 'O' }
    ],
    ...extra
  };
}

describe('TicTacToeBoard', () => {
  beforeEach(() => resetStores());

  it('pinta las nueve casillas y el marcador', () => {
    render(<TicTacToeBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);
    expect(document.querySelectorAll('.tictactoe-cell')).toHaveLength(9);
    expect(screen.getByText('Robotín')).toBeInTheDocument();
  });

  /**
   * El tablero tenía TODOS sus textos fijos en español y ni siquiera importaba
   * `useT`: cambiar de idioma no le afectaba.
   */
  it('usa las traducciones, no literales fijos', () => {
    render(<TicTacToeBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);
    // Clave i18n con parámetro: si no se tradujera, se vería la clave cruda.
    expect(screen.getByText(/Ronda 1/)).toBeInTheDocument();
    expect(screen.getByText(/Tu turno/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ttt.');
  });

  it('jugar una casilla libre emite la acción', async () => {
    const usuario = userEvent.setup();
    render(<TicTacToeBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);

    await usuario.click(document.querySelectorAll('.tictactoe-cell')[4]);
    expect(socket.ultimoEmitido('game_action')).toEqual({
      actionType: 'move', payload: { index: 4 }
    });
  });

  it('no deja jugar fuera de turno ni en casilla ocupada', () => {
    const estado = partida({ currentPlayerId: 'p_bot', board: ['X', null, null, null, null, null, null, null, null] });
    render(<TicTacToeBoard gameState={estado} playerId="p_yo" onLeave={() => {}} />);
    const celdas = document.querySelectorAll('.tictactoe-cell');
    expect(celdas[1]).toBeDisabled(); // no es mi turno
    expect(celdas[0]).toBeDisabled(); // además está ocupada
  });

  /** Sin `aria-label` un lector de pantalla anunciaba nueve botones vacíos. */
  it('cada casilla se anuncia, y dice si está ocupada', () => {
    render(<TicTacToeBoard gameState={partida({ board: ['X', ...Array(8).fill(null)] })} playerId="p_yo" onLeave={() => {}} />);
    const celdas = document.querySelectorAll('.tictactoe-cell');
    expect(celdas[0].getAttribute('aria-label')).toMatch(/1.*X/);
    expect(celdas[5].getAttribute('aria-label')).toMatch(/6/);
  });

  /** El turno CADUCA y el servidor juega por ti: sin reloj no había ni aviso. */
  it('muestra el tiempo que queda de turno', () => {
    render(<TicTacToeBoard gameState={partida({ turnEndsAt: Date.now() + 12000 })} playerId="p_yo" onLeave={() => {}} />);
    expect(document.querySelector('.tictactoe-clock')).toBeInTheDocument();
    expect(document.querySelector('.tictactoe-clock').textContent).toMatch(/1[12]s/);
  });

  it('el resultado distingue ganar, perder y empatar', () => {
    const { rerender } = render(
      <TicTacToeBoard gameState={partida({ status: 'game_ended', winner: 'X' })} playerId="p_yo" onLeave={() => {}} />
    );
    expect(screen.getByText(/Has ganado/)).toBeInTheDocument();

    act(() => {
      rerender(<TicTacToeBoard gameState={partida({ status: 'game_ended', winner: 'O' })} playerId="p_yo" onLeave={() => {}} />);
    });
    // Acotado al banner: el nombre del rival sale también en el marcador.
    expect(document.querySelector('.result-tag').textContent).toMatch(/Robotín/);

    act(() => {
      rerender(<TicTacToeBoard gameState={partida({ status: 'game_ended', winner: 'draw' })} playerId="p_yo" onLeave={() => {}} />);
    });
    expect(screen.getByText(/Empate/)).toBeInTheDocument();
  });

  it('marca la línea ganadora', () => {
    const estado = partida({
      status: 'game_ended', winner: 'X', winningLine: [0, 3, 6],
      board: ['X', 'O', null, 'X', 'O', null, 'X', null, null]
    });
    render(<TicTacToeBoard gameState={estado} playerId="p_yo" onLeave={() => {}} />);
    expect(document.querySelectorAll('.winning-cell')).toHaveLength(3);
  });
});

describe('registro de tableros', () => {
  beforeEach(() => resetStores());

  it('cada juego resuelve a su propio tablero', () => {
    expect(obtenerTablero('tictactoe')).toBe(TicTacToeBoard);
    expect(obtenerTablero('domino')).not.toBe(TicTacToeBoard);
  });

  it('un tipo desconocido cae a dominó (partidas antiguas sin gameType)', () => {
    expect(obtenerTablero(undefined)).toBe(obtenerTablero('domino'));
  });

  /**
   * `SpectatorView` pintaba el tablero de DOMINÓ fuera cual fuera el juego, y
   * las salas de tres en raya sí salen en la lista de partidas en vivo.
   */
  it('espectar un tres en raya muestra su tablero, no una mesa de dominó', () => {
    expect(obtenerTableroEspectador('tictactoe')).toBe(TicTacToeBoard);

    render(<SpectatorView gameState={partida()} onLeave={() => {}} />);
    expect(document.querySelectorAll('.tictactoe-cell')).toHaveLength(9);
  });

  it('el espectador no puede jugar', () => {
    render(<SpectatorView gameState={partida()} onLeave={() => {}} />);
    for (const celda of document.querySelectorAll('.tictactoe-cell')) {
      expect(celda).toBeDisabled();
    }
  });
});
