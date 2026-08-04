import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnoBoard from './UnoBoard';
import { obtenerTablero, obtenerTableroEspectador, capacidadesDe } from '../registry';
import { render, resetStores } from '../../test/utils';

const socket = globalThis.__socket;

const N = (color, valor) => ({ color, tipo: 'numero', valor });
const W = (tipo) => ({ color: null, tipo, valor: null });

function partida(extra = {}) {
  return {
    gameType: 'uno',
    roomId: 'ABCD',
    status: 'playing',
    maxPlayers: 4,
    roundNumber: 1,
    maxScore: 200,
    currentPlayerId: 'p_yo',
    topCard: N('rojo', 5),
    currentColor: 'rojo',
    direction: 1,
    pendingDraw: 0,
    deckCount: 60,
    playableIndices: [0, 2],
    turnEndsAt: Date.now() + 30000,
    players: [
      { id: 'p_yo', name: 'Yo', isBot: false, score: 0, handCount: 3, hand: [N('rojo', 7), N('azul', 2), W('comodin')] },
      { id: 'p_bot', name: 'Robotín', isBot: true, score: 0, handCount: 5, hand: [] }
    ],
    ...extra
  };
}

describe('UnoBoard', () => {
  beforeEach(() => resetStores());

  it('pinta tu mano y el estado de la mesa', () => {
    render(<UnoBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);
    // 3 cartas en mano + la del descarte
    expect(document.querySelectorAll('.uno-card')).toHaveLength(4);
    expect(screen.getByText('Robotín')).toBeInTheDocument();
    expect(document.querySelector('.uno-color-actual').textContent).toMatch(/Rojo/i);
  });

  /**
   * Las reglas viven SÓLO en el servidor: el cliente no recalcula qué es
   * jugable, usa `playableIndices`. Así no hay dos implementaciones que puedan
   * discrepar.
   */
  it('sólo deja pulsar las cartas que el servidor marca como jugables', () => {
    render(<UnoBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);
    const mano = document.querySelectorAll('.uno-mano .uno-card');
    expect(mano[0]).toBeEnabled();   // índice 0 → jugable
    expect(mano[1]).toBeDisabled();  // índice 1 → no
    expect(mano[2]).toBeEnabled();   // índice 2 → jugable
  });

  it('jugar una carta normal la envía directamente', async () => {
    const usuario = userEvent.setup();
    render(<UnoBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);

    await usuario.click(document.querySelectorAll('.uno-mano .uno-card')[0]);
    expect(socket.ultimoEmitido('game_action')).toEqual({
      actionType: 'play', payload: { index: 0, uno: false }
    });
  });

  /** Un comodín no puede enviarse sin color: primero hay que elegirlo. */
  it('un comodín abre el selector de color y no se envía hasta elegir', async () => {
    const usuario = userEvent.setup();
    render(<UnoBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);

    await usuario.click(document.querySelectorAll('.uno-mano .uno-card')[2]); // el comodín
    expect(socket.emitidos('game_action')).toHaveLength(0);
    expect(document.querySelector('.uno-color-picker')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: /Verde/i }));
    expect(socket.ultimoEmitido('game_action')).toEqual({
      actionType: 'play', payload: { index: 2, color: 'verde', uno: false }
    });
  });

  /**
   * Cantar UNO se ARMA antes de jugar la penúltima: si no se declara, el
   * servidor penaliza con +2.
   */
  it('el botón de cantar UNO sólo sale con dos cartas, y viaja en la jugada', async () => {
    const usuario = userEvent.setup();
    const conTres = partida();
    const { rerender } = render(<UnoBoard gameState={conTres} playerId="p_yo" onLeave={() => {}} />);
    expect(screen.queryByRole('button', { name: /^¡UNO!$/ })).toBeNull();

    const conDos = partida({
      playableIndices: [0],
      players: [
        { ...conTres.players[0], handCount: 2, hand: [N('rojo', 7), N('azul', 2)] },
        conTres.players[1]
      ]
    });
    rerender(<UnoBoard gameState={conDos} playerId="p_yo" onLeave={() => {}} />);

    await usuario.click(screen.getByRole('button', { name: /^¡UNO!$/ }));
    await usuario.click(document.querySelectorAll('.uno-mano .uno-card')[0]);

    expect(socket.ultimoEmitido('game_action').payload.uno).toBe(true);
  });

  it('robar y pasar emiten sus acciones', async () => {
    const usuario = userEvent.setup();
    render(<UnoBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);

    await usuario.click(screen.getByRole('button', { name: /^Robar$/ }));
    expect(socket.ultimoEmitido('game_action')).toEqual({ actionType: 'draw', payload: {} });

    await usuario.click(screen.getByRole('button', { name: /^Pasar$/ }));
    expect(socket.ultimoEmitido('game_action')).toEqual({ actionType: 'pass', payload: {} });
  });

  it('con deuda acumulada avisa de cuánto hay que robar', () => {
    render(
      <UnoBoard
        gameState={partida({ pendingDraw: 6, playableIndices: [] })}
        playerId="p_yo"
        onLeave={() => {}}
      />
    );
    expect(document.querySelector('.uno-deuda').textContent).toMatch(/6/);
    expect(screen.getByRole('button', { name: /Robar 6/i })).toBeInTheDocument();
  });

  it('fuera de turno no se puede jugar nada', () => {
    render(
      <UnoBoard gameState={partida({ currentPlayerId: 'p_bot' })} playerId="p_yo" onLeave={() => {}} />
    );
    for (const carta of document.querySelectorAll('.uno-mano .uno-card')) {
      expect(carta).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: /^Robar$/ })).toBeNull();
  });

  it('marca a quien se ha quedado con una carta', () => {
    render(
      <UnoBoard
        gameState={partida({
          players: [
            { id: 'p_yo', name: 'Yo', isBot: false, score: 0, handCount: 3, hand: [N('rojo', 7), N('azul', 2), W('comodin')] },
            { id: 'p_bot', name: 'Robotín', isBot: true, score: 0, handCount: 1, hand: [] }
          ]
        })}
        playerId="p_yo"
        onLeave={() => {}}
      />
    );
    expect(document.querySelector('.uno-badge-uno')).toBeInTheDocument();
  });

  it('al acabar la ronda ofrece seguir, y al acabar la partida volver a empezar', () => {
    const { rerender } = render(
      <UnoBoard gameState={partida({ status: 'round_ended', roundWinnerId: 'p_bot' })} playerId="p_yo" onLeave={() => {}} />
    );
    expect(screen.getByRole('button', { name: /Siguiente ronda/i })).toBeInTheDocument();

    rerender(
      <UnoBoard gameState={partida({ status: 'game_ended', gameWinner: 'p_yo' })} playerId="p_yo" onLeave={() => {}} />
    );
    expect(screen.getByRole('button', { name: /Jugar otra partida/i })).toBeInTheDocument();
  });

  it('no hay literales sin traducir', () => {
    render(<UnoBoard gameState={partida()} playerId="p_yo" onLeave={() => {}} />);
    expect(document.body.textContent).not.toContain('uno.');
  });
});

describe('Uno en el registro del hub', () => {
  it('resuelve a su propio tablero, también para espectar', () => {
    expect(obtenerTablero('uno')).toBe(UnoBoard);
    expect(obtenerTableroEspectador('uno')).toBe(UnoBoard);
  });

  it('declara sus capacidades: sin opciones de dominó, ni ranked ni torneos', () => {
    const uno = capacidadesDe('uno');
    expect(uno.nombre).toBe('Uno');
    expect(uno.opcionesDeSala).toBe(false);
    expect(uno.clasificatoria).toBe(false);
    expect(uno.torneos).toBe(false);
  });

  it('el espectador no ve ninguna mano y no puede jugar', () => {
    // El servidor manda las manos vacías; el turno nunca es suyo.
    const comoEspectador = partida({
      currentPlayerId: 'p_bot',
      playableIndices: [],
      players: partida().players.map(p => ({ ...p, hand: [] }))
    });
    render(<UnoBoard gameState={comoEspectador} playerId="" onLeave={() => {}} />);
    expect(document.querySelectorAll('.uno-mano .uno-card')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Robar$/ })).toBeNull();
  });
});
