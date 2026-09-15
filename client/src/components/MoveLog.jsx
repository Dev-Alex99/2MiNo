import React from 'react';
import { createPortal } from 'react-dom';
import { X, ScrollText } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import useModalA11y from '../hooks/useModalA11y';

export default function MoveLog({ moveLog = [], onClose }) {
  const { t } = useT();
  const { propsPanel, propsTitulo } = useModalA11y(onClose);

  // El detalle se reconstruye en el cliente desde los datos estructurados
  // (acción/ficha/lado) para localizarlo, en vez de usar el string del servidor.
  const detailText = (entry) => {
    if (entry.action === 'play' && Array.isArray(entry.tile)) {
      const side = entry.side === 'left' ? t('board.left') : t('board.right');
      return `[${entry.tile[0]}|${entry.tile[1]}] (${side})`;
    }
    if (entry.action === 'draw') return t('log.drewDetail');
    if (entry.action === 'pass') {
      // Los extremos sólo viajan cuando el pase revela un fallo de verdad; un
      // pase forzado por Congelar o Maldición llega sin ellos. Sin dato no se
      // enseña nada: enseñarlo afirmaría que a ese jugador le faltan unos
      // números que probablemente tiene.
      const ends = entry.ends;
      if (Array.isArray(ends) && ends.length === 2) {
        return `${t('log.passedDetail')} · ${t('board.left')} ${ends[0]} · ${t('board.right')} ${ends[1]}`;
      }
      return t('log.passedDetail');
    }
    return entry.detail || '';
  };

  const getActionBadge = (action) => {
    switch (action) {
      case 'play':
        return { icon: '🎴', label: t('log.play'), color: '#10b981' };
      case 'draw':
        return { icon: '📦', label: t('log.draw'), color: '#3b82f6' };
      case 'pass':
        return { icon: '🪵', label: t('log.pass'), color: '#f59e0b' };
      case 'power':
        return { icon: '⚡', label: t('log.power'), color: '#a78bfa' };
      default:
        return { icon: '📢', label: t('log.system'), color: '#94a3b8' };
    }
  };

  // Sale por portal a la raíz del documento: siendo hijo de
  // .game-board-container heredaba su `touch-action`, así que la lista no se
  // podía desplazar con el dedo y cada toque paneaba el tablero de debajo.
  return createPortal(
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div
        className="modal-card glass-panel animate-scale-up move-log-card modal-a11y"
        {...propsPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="profile-close" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} />
        </button>

        <div className="move-log-header">
          <ScrollText size={20} className="move-log-icon" aria-hidden="true" />
          <div>
            <h3 className="move-log-title" {...propsTitulo}>{t('log.title')}</h3>
            <span className="move-log-subtitle">{t('log.subtitle', { n: moveLog.length })}</span>
          </div>
        </div>

        {/* La lista es la única parte con scroll del diálogo: si no fuera una
            parada de tabulación, las flechas del teclado no tendrían nada que
            desplazar y la crónica sería inalcanzable sin ratón. */}
        <div
          className="move-log-body"
          tabIndex={0}
          role="group"
          aria-label={t('log.subtitle', { n: moveLog.length })}
        >
          {moveLog.length === 0 ? (
            <div className="move-log-empty">
              <span>{t('log.empty')}</span>
            </div>
          ) : (
            <div className="move-log-list">
              {moveLog.slice().reverse().map((entry, idx) => {
                const badge = getActionBadge(entry.action);
                return (
                  <div key={entry.id || idx} className="move-log-item">
                    <div className="move-log-time">{entry.time || ''}</div>
                    <span className="move-log-badge" style={{ backgroundColor: `${badge.color}20`, color: badge.color, borderColor: `${badge.color}40` }}>
                      {badge.icon} {badge.label}
                    </span>
                    <div className="move-log-info">
                      <span className="move-log-player">{entry.player}:</span>
                      <span className="move-log-detail">{detailText(entry)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
