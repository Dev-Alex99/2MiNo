import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import useGameActions from './useGameActions';
import useGameSocket from './useGameSocket';
import { useGameStore } from '../store/useGameStore';
import { render, resetStores, setGameStore, setHubStore } from '../test/utils';

const socket = globalThis.__socket;

// Sonda: monta el hook y expone sus acciones para invocarlas desde el test.
let acciones;
function Sonda(props) {
  acciones = useGameActions({
    tournament: null,
    setTournament: () => {},
    setShowTournamentEntry: () => {},
    setSearchingRanked: () => {},
    incomingInvite: null,
    setIncomingInvite: () => {},
    resetGameStatus: () => {},
    ...props
  });
  return null;
}

/**
 * Sonda con las DOS capas cableadas como en la app: la que escucha y la que
 * emite. Hace falta para el viaje completo de la identidad —entrar en una sala
 * llega por socket, salir es una acción— sin montar `App` entero ni pulsar
 * botones de una vista ajena.
 */
function SondaCompleta() {
  const invitedCodeRef = React.useRef('');
  const net = useGameSocket({ invitedCodeRef });
  acciones = useGameActions({
    tournament: net.tournament,
    setTournament: net.setTournament,
    setShowTournamentEntry: net.setShowTournamentEntry,
    setSearchingRanked: net.setSearchingRanked,
    incomingInvite: net.incomingInvite,
    setIncomingInvite: net.setIncomingInvite,
    resetGameStatus: net.resetGameStatus
  });
  return null;
}

describe('useGameActions', () => {
  beforeEach(() => {
    resetStores();
    acciones = null;
  });

  it('crear sala usa el juego seleccionado en el hub', () => {
    setGameStore({ name: 'Ana' });
    setHubStore({ selectedGameId: 'tictactoe' });
    render(<Sonda />);

    act(() => acciones.handleCreateRoom({ maxPip: 9, teamsEnabled: true }));

    const payload = socket.ultimoEmitido('create_room');
    expect(payload.gameType).toBe('tictactoe');
    expect(payload.name).toBe('Ana');
    expect(payload.maxPip).toBe(9);
    expect(payload.teamsEnabled).toBe(true);
  });

  /**
   * A-2: el cliente ya no puede declarar su sala clasificatoria. El servidor lo
   * ignora, pero el cliente tampoco debe mandarlo (el interruptor se retiró del
   * lobby porque habría mentido: decía «Afecta al ELO» sin hacer nada).
   */
  it('crear sala NUNCA envía `ranked`', () => {
    setGameStore({ name: 'Ana' });
    render(<Sonda />);
    act(() => acciones.handleCreateRoom({ ranked: true }));
    expect(socket.ultimoEmitido('create_room').ranked).toBeUndefined();
  });

  it('las jugadas se envían con la sala y el jugador actuales', () => {
    setGameStore({ roomId: 'ABCD', playerId: 'p_test' });
    render(<Sonda />);

    act(() => acciones.handlePlayTile(2, 'left'));
    expect(socket.ultimoEmitido('play_tile')).toEqual({
      roomId: 'ABCD', playerId: 'p_test', tileIndex: 2, side: 'left'
    });

    act(() => acciones.handleDrawTile());
    expect(socket.ultimoEmitido('draw_tile')).toEqual({ roomId: 'ABCD', playerId: 'p_test' });

    act(() => acciones.handlePassTurn());
    expect(socket.ultimoEmitido('pass_turn')).toEqual({ roomId: 'ABCD', playerId: 'p_test' });
  });

  it('sin sala no se emite ninguna jugada', () => {
    setGameStore({ roomId: '', playerId: 'p_test' });
    render(<Sonda />);

    act(() => {
      acciones.handlePlayTile(0, 'left');
      acciones.handleDrawTile();
      acciones.handlePassTurn();
      acciones.handleUsePower('skip', null, null);
    });

    expect(socket.emitidos('play_tile')).toHaveLength(0);
    expect(socket.emitidos('draw_tile')).toHaveLength(0);
    expect(socket.emitidos('pass_turn')).toHaveLength(0);
    expect(socket.emitidos('use_power_card')).toHaveLength(0);
  });

  /**
   * El hook NO se suscribe al store: lee con `getState()` al ejecutarse. Esto
   * comprueba justo eso — si capturase el valor del render, seguiría mandando la
   * sala vieja después de cambiarla.
   */
  it('lee el estado FRESCO, no el del render en que se creó la acción', () => {
    setGameStore({ roomId: 'VIEJA', playerId: 'p_test' });
    render(<Sonda />);

    // Cambiar la sala SIN volver a renderizar la sonda.
    act(() => setGameStore({ roomId: 'NUEVA' }));
    act(() => acciones.handleDrawTile());

    expect(socket.ultimoEmitido('draw_tile').roomId).toBe('NUEVA');
  });

  it('contrabando manda la ficha elegida; los demás poderes no', () => {
    setGameStore({
      roomId: 'ABCD', playerId: 'p_test',
      selectedPower: { id: 'smuggle' }, smuggleTileIdx: 3
    });
    render(<Sonda />);
    act(() => acciones.handlePlayerTargetSelected('p_rival'));

    expect(socket.ultimoEmitido('use_power_card')).toMatchObject({
      cardId: 'smuggle', targetId: 'p_rival', tileIndex: 3
    });

    act(() => setGameStore({ selectedPower: { id: 'spy_eye' }, smuggleTileIdx: 3 }));
    act(() => acciones.handlePlayerTargetSelected('p_rival'));
    expect(socket.ultimoEmitido('use_power_card')).toMatchObject({
      cardId: 'spy_eye', targetId: 'p_rival', tileIndex: null
    });
  });

  it('salir de la sala limpia el almacenamiento y el estado', () => {
    setGameStore({ roomId: 'ABCD', playerId: 'p_test' });
    sessionStorage.setItem('domino_room_id', 'ABCD');
    sessionStorage.setItem('domino_player_id', 'p_test');
    render(<Sonda />);

    act(() => acciones.handleLeaveRoom());

    expect(socket.emitidos('leave_room')).toHaveLength(1);
    expect(sessionStorage.getItem('domino_room_id')).toBeNull();
    expect(sessionStorage.getItem('domino_player_id')).toBeNull();
  });

  /**
   * EL VIAJE COMPLETO DE LAS DOS IDENTIDADES, que es el motivo de este paquete.
   * Antes, salir de una sala dejaba `playerId` en cadena vacía — y `playerId`
   * era también la dirección por la que te llamaban, así que el jugador volvía
   * al hub siendo inllamable justo en la pantalla desde la que más se llama.
   */
  it('entrar en una sala y salir deja la cuenta intacta y el asiento vacío', () => {
    render(<SondaCompleta />);
    const cuentaAlEmpezar = useGameStore.getState().cuentaId;

    act(() => socket.recibir('room_joined', { roomId: 'ABCD', playerId: 's_1a2b' }));
    expect(useGameStore.getState().playerId).toBe('s_1a2b');
    expect(useGameStore.getState().cuentaId).toBe(cuentaAlEmpezar);

    act(() => acciones.handleLeaveRoom());

    const s = useGameStore.getState();
    expect(s.playerId).toBe('');
    expect(s.roomId).toBe('');
    expect(s.cuentaId).toBe(cuentaAlEmpezar);
  });

  it('salir del torneo también suelta el asiento de su última eliminatoria', () => {
    setGameStore({ roomId: 'ABCD', playerId: 's_1a2b' });
    sessionStorage.setItem('domino_room_id', 'ABCD');
    sessionStorage.setItem('domino_player_id', 's_1a2b');
    render(<Sonda tournament={{ id: 'T1' }} />);

    act(() => acciones.handleExitTournament());

    const s = useGameStore.getState();
    expect(s.playerId).toBe('');
    expect(s.roomId).toBe('');
    expect(s.cuentaId).toBe('p_cuenta');
    expect(sessionStorage.getItem('domino_room_id')).toBeNull();
    expect(sessionStorage.getItem('domino_player_id')).toBeNull();
  });

  it('sin nombre, torneo y clasificatoria avisan en vez de emitir', () => {
    setGameStore({ name: '   ' });
    render(<Sonda />);

    act(() => acciones.handleCreateTournament());
    act(() => acciones.handleFindRanked());

    expect(socket.emitidos('create_tournament')).toHaveLength(0);
    expect(socket.emitidos('join_queue')).toHaveLength(0);
  });
});
