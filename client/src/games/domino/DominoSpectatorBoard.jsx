import React from 'react';
import GameBoard from '../../components/GameBoard';
import CintaTurno from '../../components/CintaTurno';
import { fichasDelMazo } from './trazado';

/**
 * Tablero de dominó en modo espectador: el mismo motor de mesa, pero sin
 * ninguna interacción. El servidor ya manda una vista sin manos ni poderes.
 *
 * Vive aquí y se registra en `games/registry.js` porque `SpectatorView` pintaba
 * el tablero de dominó fuera cual fuera el juego: espectar una partida de tres
 * en raya mostraba una mesa de dominó vacía.
 *
 * Lleva cinta pero ni riel ni mano: sin mano no hay nada que jugar, y los dos
 * botones del riel prometerían una jugada imposible. La cinta sí aporta lo que
 * la lista de `SpectatorView` no tiene: de quién es el turno, cuánto le queda y
 * sobre qué números ha pasado cada uno.
 */
export default function DominoSpectatorBoard({ gameState }) {
  const maxPip = Number.isFinite(gameState.maxPip) ? gameState.maxPip : 6;

  return (
    // `SpectatorView` mete este componente dentro de `.board-region.spec-board`,
    // que es `display: flex` en fila: sin esta envoltura en columna la cinta se
    // pondría al costado de la mesa y no encima. El alto lo pone la propia
    // cinta y la mesa se queda con el resto.
    <div
      style={{
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0
      }}
    >
      {/* Sin `playerId` ni `onSelectPlayerTarget`: se pinta a todos, ninguno
          destacado como propio y ningún chip pulsable. */}
      <CintaTurno
        players={gameState.players || []}
        currentPlayerId={gameState.currentPlayerId}
        teamsEnabled={gameState.teamsEnabled}
        powersEnabled={gameState.powersEnabled}
        blitzTimeRemaining={gameState.blitzTimeRemaining}
        turnEndsAt={gameState.turnEndsAt}
        turnSecondsRemaining={gameState.turnSecondsRemaining}
        turnDurationSeconds={gameState.turnDurationSeconds}
        playerPassedOn={gameState.playerPassedOn}
        esEspectador
      />

      {/* `.game-board-container` cuelga directamente de la columna, igual que
          antes colgaba de `.spec-board`: ya trae `flex-grow: 1` y `min-height:
          0`, así que se queda con el alto que la cinta no usa. */}
      <GameBoard
        board={gameState.board}
        players={gameState.players || []}
        lastPlay={gameState.lastPlay}
        lastPlacedTile={gameState.lastPlacedTile}
        lastPlacedBy={gameState.lastPlacedBy}
        moveLog={gameState.moveLog || []}
        totalMazo={fichasDelMazo(maxPip)}
        maxPip={maxPip}
      />
    </div>
  );
}
