import React from 'react';
import { X, ScrollText, Play, Download, Zap, RefreshCw } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

export default function MoveLog({ moveLog = [], onClose }) {
  const { t } = useT();

  // El detalle se reconstruye en el cliente desde los datos estructurados
  // (acción/ficha/lado) para localizarlo, en vez de usar el string del servidor.
  const detailText = (entry) => {
    if (entry.action === 'play' && Array.isArray(entry.tile)) {
      const side = entry.side === 'left' ? t('board.left') : t('board.right');
      return `[${entry.tile[0]}|${entry.tile[1]}] (${side})`;
    }
    if (entry.action === 'draw') return t('log.drewDetail');
    if (entry.action === 'pass') return t('log.passedDetail');
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

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up move-log-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-close" onClick={onClose} aria-label={t('common.cancel')}>
          <X size={18} />
        </button>

        <div className="move-log-header">
          <ScrollText size={20} className="move-log-icon" />
          <div>
            <h3 className="move-log-title">{t('log.title')}</h3>
            <span className="move-log-subtitle">{t('log.subtitle', { n: moveLog.length })}</span>
          </div>
        </div>

        <div className="move-log-body">
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
    </div>
  );
}
