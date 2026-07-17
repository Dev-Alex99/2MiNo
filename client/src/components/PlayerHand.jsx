import React from 'react';
import { Download, ArrowLeftRight, HelpCircle } from 'lucide-react';
import DominoTile from './DominoTile';
import { useT } from '../i18n/LanguageContext';

export default function PlayerHand({
  hand,
  isMyTurn,
  selectedTileIndex,
  setSelectedTileIndex,
  leftEnd,
  rightEnd,
  onPlay,
  onDraw,
  onPass,
  boneyardCount,
  boardIsEmpty,
  onTileClickOverride,
  wildcardActive = false,
  drawEnabled = true
}) {
  const { t } = useT();

  // Verifica si una ficha es jugable en el tablero actual
  const getPlayableSides = (tile) => {
    if (!isMyTurn) return { left: false, right: false };
    if (wildcardActive) return { left: true, right: !boardIsEmpty };
    if (boardIsEmpty) return { left: true, right: true };

    const [a, b] = tile;
    return {
      left: a === leftEnd || b === leftEnd,
      right: a === rightEnd || b === rightEnd
    };
  };

  const hasMoves = hand.some(tile => {
    const { left, right } = getPlayableSides(tile);
    return left || right;
  });

  const handleTileClick = (index, tile) => {
    if (!isMyTurn) return;

    if (onTileClickOverride) {
      onTileClickOverride(index, tile);
      return;
    }

    const { left, right } = getPlayableSides(tile);
    if (!left && !right) return; // No es jugable

    // Siempre seleccionar la ficha para que el jugador elija el extremo en el tablero,
    // garantizando un control de juego premium y previniendo errores accidentales.
    if (selectedTileIndex === index) {
      setSelectedTileIndex(null);
    } else {
      setSelectedTileIndex(index);
    }
  };

  return (
    <div className="player-hand-container">
      
      {/* Indicador de Estado / Acciones Rápidas */}
      <div className="hand-status-row">
        {isMyTurn ? (
          !hasMoves ? (
            drawEnabled && boneyardCount > 0 ? (
              <button
                onClick={onDraw}
                className="btn-premium btn-accent"
                style={{ padding: '8px 20px', fontSize: '0.8rem' }}
              >
                <Download size={16} />
                {t('hand.drawFromBoneyard', { n: boneyardCount })}
              </button>
            ) : (
              <button
                onClick={onPass}
                className="btn-premium btn-secondary"
                style={{ padding: '8px 20px', fontSize: '0.8rem', color: '#f59e0b' }}
              >
                <ArrowLeftRight size={16} />
                {drawEnabled ? t('hand.passNoDraw') : t('hand.passNoPlay')}
              </button>
            )
          ) : selectedTileIndex !== null ? (
            <div className="select-hint-box">
              <span>{t('hand.selectEnd')}</span>
              <button
                onClick={() => setSelectedTileIndex(null)}
                className="select-hint-cancel"
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <div className="turn-notification">
              <span className="turn-notification-ping"></span>
              {t('hand.yourTurnSelect')}
            </div>
          )
        ) : (
          <div className="waiting-turn-msg">
            {t('hand.waiting')}
          </div>
        )}
      </div>

      {/* Fichas del Jugador */}
      <div className="hand-tiles-row">
        {hand.map((tile, index) => {
          const { left, right } = getPlayableSides(tile);
          const isPlayable = left || right;
          const isSelected = selectedTileIndex === index;
          const tileKey = `${tile[0]}-${tile[1]}`;

          return (
            <div 
              key={tileKey} 
              className="relative hand-tile-wrapper"
              style={{
                zIndex: isSelected ? 15 : undefined,
                position: 'relative'
              }}
            >
              <DominoTile
                tile={tile}
                onClick={() => handleTileClick(index, tile)}
                selected={isSelected}
                playable={isMyTurn && isPlayable}
                disabled={isMyTurn && !isPlayable && !onTileClickOverride}
                className="hand-tile"
              />
              
              {/* Indicador visual rápido de que la ficha puede jugarse en ambos lados */}
              {isMyTurn && left && right && !isSelected && (
                <span className="tile-double-badge">
                  {t('hand.both')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
