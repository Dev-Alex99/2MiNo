import React from 'react';
import GameBoard from '../../components/GameBoard';
import PlayerHand from '../../components/PlayerHand';
import CintaTurno from '../../components/CintaTurno';
import PowerCards from '../../components/PowerCards';
import VideoGrid from '../../components/VideoGrid';
import { contarJugables } from './jugadas';
import { fichasDelMazo } from './trazado';
import { useT } from '../../i18n/LanguageContext';
import { useGameStore } from '../../store/useGameStore';

/**
 * Tablero de dominó: todo lo específico del juego (fichas, extremos jugables,
 * poderes, cinta de turno). Se registra en `games/registry.js` bajo el id
 * 'domino'.
 *
 * Antes este bloque estaba incrustado en `GameView` detrás de un
 * `gameState.gameType === 'tictactoe' ? ... : ...`, así que cada juego nuevo del
 * hub obligaba a añadir otra rama al mismo condicional. Ahora `GameView` sólo
 * pide al registro el tablero que toca.
 *
 * El orden del DOM es el orden en el que se juega —mano, riel, poderes, cinta,
 * mesa— para que la tabulación llegue primero a lo que se usa cada turno. La
 * pila vuelve a su sitio en pantalla con `order`; el desajuste entre el orden
 * de lectura y el visual es deliberado y se mitiga con el enlace de salto.
 */

// Reparto de `order` de las bandas de .game-area: cinta 1, mesa 2, poderes 3,
// riel 4, mano 5. La cinta y el riel declaran el suyo en cinta.css y riel.css,
// que son sus archivos; los tres que faltan van como estilo en línea porque
// este paquete no tiene hoja propia donde escribirlos ni puede tocar las ajenas.
const ORDEN_MESA = 2;
const ORDEN_PODERES = 3;
const ORDEN_MANO = 5;

// Ancla del enlace de salto. El enlace tiene que apuntar a un elemento que
// pueda recibir el foco, y `.player-hand-container` es de otro paquete: la
// envoltura que ya hace falta para el `order` sirve también de destino.
const ID_MANO = 'mano-jugador';

export default function DominoBoard({ actions, isMyTurn, onOpenBracket }) {
  const { t } = useT();
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
  const tableroVacio = !Array.isArray(gameState.board) || gameState.board.length === 0;

  const canPlayLeft = fichaElegida
    && (comodinActivo || tableroVacio
      || fichaElegida[0] === leftEnd || fichaElegida[1] === leftEnd)
    && !izquierdaCongelada;
  const canPlayRight = fichaElegida
    && !tableroVacio
    && (comodinActivo || fichaElegida[0] === rightEnd || fichaElegida[1] === rightEnd)
    && !derechaCongelada;

  // Cuántas fichas de la mano encajan en algún extremo. Es el número que el
  // riel enseña y lo que decide si sale el botón de robar/pasar, que antes vivía
  // en la mano. Misma regla de siempre, ahora en un módulo compartido.
  const contexto = {
    isMyTurn,
    wildcardActive: comodinActivo,
    boardIsEmpty: tableroVacio,
    leftEnd,
    rightEnd
  };
  const jugablesCount = contarJugables(me ? me.hand : [], contexto);

  // El tamaño del mazo NO se deduce sumando manos, pozo y tablero:
  // `tile_demolition` destruye fichas y esa suma miente. Sale de maxPip, que el
  // servidor difunde en el estado compartido.
  const maxPip = Number.isFinite(gameState.maxPip) ? gameState.maxPip : 6;
  const totalMazo = fichasDelMazo(maxPip);

  // El riel nombra a las personas, no a los ids: `frozenEndOwnerId` y
  // `currentPlayerId` se resuelven aquí, que es donde está la lista.
  const jugadores = Array.isArray(gameState.players) ? gameState.players : [];
  const nombreDe = (id) => (jugadores.find(p => p.id === id) || {}).name || null;

  return (
    <div className="game-area">
      {/* Primera parada de tabulación de la partida: invisible hasta que se
          enfoca. Es `position: fixed` (a11y.css), así que no es un elemento
          flexible y no necesita `order`. */}
      {me && (
        <a className="salto-a-mano" href={`#${ID_MANO}`}>{t('a11y.saltoAMano')}</a>
      )}

      {me && (
        <div id={ID_MANO} tabIndex={-1} style={{ order: ORDEN_MANO, flexShrink: 0 }}>
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
            boardIsEmpty={tableroVacio}
            wildcardActive={comodinActivo}
            drawEnabled={gameState.drawEnabled !== false}
            onTileClickOverride={
              (pendingTargetType === 'hand_tile_target' || pendingTargetType === 'smuggle_select_tile')
                ? actions.handleTileClickOverride
                : null
            }
          />
        </div>
      )}

      {me && gameState.status === 'playing' && gameState.powersEnabled !== false && (
        <div style={{ order: ORDEN_PODERES, flexShrink: 0 }}>
          <PowerCards
            powers={me.powers}
            isMyTurn={isMyTurn}
            onUsePower={actions.handleUsePower}
            selectedPower={selectedPower}
            setSelectedPower={setSelectedPower}
            pendingTargetType={pendingTargetType}
            setPendingTargetType={setPendingTargetType}
          />
        </div>
      )}

      {/* Sustituye a los asientos flotantes: los ocho papeles que hacían
          (vídeo del rival, anillo de voz, corona, escudo, micro, insignia de
          blitz, quién acaba de hablar y el estado de objetivo de un poder)
          viven ahora en el chip, en flujo y sin robarle ancho a la mesa. */}
      <CintaTurno
        players={gameState.players}
        playerId={playerId}
        currentPlayerId={gameState.currentPlayerId}
        teamsEnabled={gameState.teamsEnabled}
        powersEnabled={gameState.powersEnabled}
        pendingTargetType={pendingTargetType}
        onSelectPlayerTarget={actions.handlePlayerTargetSelected}
        quickNotifications={quickNotifications}
        blitzTimeRemaining={gameState.blitzTimeRemaining}
        turnEndsAt={gameState.turnEndsAt}
        turnSecondsRemaining={gameState.turnSecondsRemaining}
        turnDurationSeconds={gameState.turnDurationSeconds}
        playerPassedOn={gameState.playerPassedOn}
      />

      {/* Envuelve tablero y chat para que el botón flotante del chat quede
          anclado a la mesa y no encima de las fichas de la mano. */}
      <div className="board-region" style={{ order: ORDEN_MESA }}>
        <GameBoard
          board={gameState.board}
          players={gameState.players}
          lastPlay={gameState.lastPlay}
          lastPlacedTile={gameState.lastPlacedTile}
          lastPlacedBy={gameState.lastPlacedBy}
          moveLog={gameState.moveLog || []}
          onOpenBracket={onOpenBracket}
          totalMazo={totalMazo}
          maxPip={maxPip}
          selectedTileIndex={selectedTileIndex}
          onPlay={actions.handlePlayTile}
          isMyTurn={isMyTurn}
          canPlayLeft={canPlayLeft}
          canPlayRight={canPlayRight}
          pendingTargetType={pendingTargetType}
          onSelectEndTarget={actions.handleEndTargetSelected}
          activeEffects={gameState.activeEffects}
          selectedPower={selectedPower}
        />

        <VideoGrid players={gameState.players} playerId={playerId} selfOnly />
      </div>
    </div>
  );
}
