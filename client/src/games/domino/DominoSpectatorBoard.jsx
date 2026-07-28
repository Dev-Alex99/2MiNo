import React from 'react';
import GameBoard from '../../components/GameBoard';

const noop = () => {};

/**
 * Tablero de dominó en modo espectador: el mismo `GameBoard`, pero sin ninguna
 * interacción. El servidor ya manda una vista sin manos ni poderes.
 *
 * Vive aquí y se registra en `games/registry.js` porque `SpectatorView` pintaba
 * el tablero de dominó fuera cual fuera el juego: espectar una partida de tres
 * en raya mostraba una mesa de dominó vacía.
 */
export default function DominoSpectatorBoard({ gameState }) {
  return (
    <GameBoard
      board={gameState.board}
      selectedTileIndex={null}
      onPlay={noop}
      isMyTurn={false}
      players={gameState.players || []}
      canPlayLeft={false}
      canPlayRight={false}
      pendingTargetType={null}
      onSelectEndTarget={noop}
      activeEffects={gameState.activeEffects}
      lastPlay={gameState.lastPlay}
      lastPlacedTile={gameState.lastPlacedTile}
      lastPlacedBy={gameState.lastPlacedBy}
      seatsPadding={40}
    />
  );
}
