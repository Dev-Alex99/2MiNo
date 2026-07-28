import React from 'react';
import GameBoard from '../../components/GameBoard';
import PlayerHand from '../../components/PlayerHand';
import Chat from '../../components/Chat';
import PowerCards from '../../components/PowerCards';
import VideoGrid from '../../components/VideoGrid';
import PlayerSeats from '../../components/PlayerSeats';
import useIsMobile from '../../hooks/useIsMobile';
import { useGameStore } from '../../store/useGameStore';

/**
 * Tablero de dominó: todo lo específico del juego (fichas, extremos jugables,
 * poderes, asientos). Se registra en `games/registry.js` bajo el id 'domino'.
 *
 * Antes este bloque estaba incrustado en `GameView` detrás de un
 * `gameState.gameType === 'tictactoe' ? ... : ...`, así que cada juego nuevo del
 * hub obligaba a añadir otra rama al mismo condicional. Ahora `GameView` sólo
 * pide al registro el tablero que toca.
 */
export default function DominoBoard({ actions, isMyTurn, onOpenBracket }) {
  const isMobile = useIsMobile();
  const {
    playerId, roomId, gameState,
    selectedTileIndex, setSelectedTileIndex,
    selectedPower, setSelectedPower,
    pendingTargetType, setPendingTargetType,
    quickNotifications
  } = useGameStore();

  const me = Array.isArray(gameState.players)
    ? gameState.players.find(p => p.id === playerId)
    : null;

  // Extremos jugables. El tablero de dominó es una lista de fichas [a, b]; el
  // hub aloja juegos cuyo `board` tiene otra forma, de ahí la comprobación.
  const esTableroDeFichas = Array.isArray(gameState.board)
    && gameState.board.length > 0
    && Array.isArray(gameState.board[0]);
  const leftEnd = esTableroDeFichas ? gameState.board[0][0] : null;
  const rightEnd = esTableroDeFichas ? gameState.board[gameState.board.length - 1][1] : null;

  const fichaElegida = me && Array.isArray(me.hand) && selectedTileIndex !== null
    ? me.hand[selectedTileIndex]
    : null;

  const izquierdaCongelada = gameState.activeEffects?.frozenEnd === 'left'
    && gameState.activeEffects?.frozenEndOwnerId !== playerId;
  const derechaCongelada = gameState.activeEffects?.frozenEnd === 'right'
    && gameState.activeEffects?.frozenEndOwnerId !== playerId;
  const comodinActivo = gameState.activeEffects?.wildcardActive;

  const canPlayLeft = fichaElegida
    && (comodinActivo || gameState.board.length === 0
      || fichaElegida[0] === leftEnd || fichaElegida[1] === leftEnd)
    && !izquierdaCongelada;
  const canPlayRight = fichaElegida
    && gameState.board.length > 0
    && (comodinActivo || fichaElegida[0] === rightEnd || fichaElegida[1] === rightEnd)
    && !derechaCongelada;

  return (
    <div className="game-area">
      <div className="board-region">
        <GameBoard
          board={gameState.board}
          selectedTileIndex={selectedTileIndex}
          onPlay={actions.handlePlayTile}
          isMyTurn={isMyTurn}
          players={gameState.players}
          canPlayLeft={canPlayLeft}
          canPlayRight={canPlayRight}
          pendingTargetType={pendingTargetType}
          onSelectEndTarget={actions.handleEndTargetSelected}
          activeEffects={gameState.activeEffects}
          lastPlay={gameState.lastPlay}
          lastPlacedTile={gameState.lastPlacedTile}
          lastPlacedBy={gameState.lastPlacedBy}
          seatsPadding={isMobile ? 170 : 240}
          moveLog={gameState.moveLog || []}
          onOpenBracket={onOpenBracket}
          selectedPower={selectedPower}
        />

        <Chat roomId={roomId} playerId={playerId} />

        <VideoGrid players={gameState.players} playerId={playerId} selfOnly />

        <PlayerSeats
          players={gameState.players}
          playerId={playerId}
          currentPlayerId={gameState.currentPlayerId}
          teamsEnabled={gameState.teamsEnabled}
          powersEnabled={gameState.powersEnabled}
          pendingTargetType={pendingTargetType}
          onSelectPlayerTarget={actions.handlePlayerTargetSelected}
          quickNotifications={quickNotifications}
          blitzTimeRemaining={gameState.blitzTimeRemaining}
        />
      </div>

      {me && gameState.status === 'playing' && gameState.powersEnabled !== false && (
        <PowerCards
          powers={me.powers}
          isMyTurn={isMyTurn}
          onUsePower={actions.handleUsePower}
          selectedPower={selectedPower}
          setSelectedPower={setSelectedPower}
          pendingTargetType={pendingTargetType}
          setPendingTargetType={setPendingTargetType}
        />
      )}

      {me && (
        <PlayerHand
          hand={me.hand}
          isMyTurn={isMyTurn}
          selectedTileIndex={selectedTileIndex}
          setSelectedTileIndex={setSelectedTileIndex}
          leftEnd={leftEnd}
          rightEnd={rightEnd}
          onPlay={actions.handlePlayTile}
          onDraw={actions.handleDrawTile}
          onPass={actions.handlePassTurn}
          boneyardCount={gameState.boneyardCount}
          boardIsEmpty={gameState.board.length === 0}
          wildcardActive={comodinActivo}
          drawEnabled={gameState.drawEnabled !== false}
          onTileClickOverride={
            (pendingTargetType === 'hand_tile_target' || pendingTargetType === 'smuggle_select_tile')
              ? actions.handleTileClickOverride
              : null
          }
        />
      )}
    </div>
  );
}
