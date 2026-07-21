import React from 'react';
import { X, ScrollText, Play, Download, Zap, RefreshCw } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

export default function MoveLog({ moveLog = [], onClose }) {
  const { t } = useT();

  const getActionBadge = (action) => {
    switch (action) {
      case 'play':
        return { icon: '🎴', label: 'Jugada', color: '#10b981' };
      case 'draw':
        return { icon: '📦', label: 'Robo', color: '#3b82f6' };
      case 'pass':
        return { icon: '🪵', label: 'Paso', color: '#f59e0b' };
      case 'power':
        return { icon: '⚡', label: 'Poder', color: '#a78bfa' };
      default:
        return { icon: '📢', label: 'Sistema', color: '#94a3b8' };
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
                      <span className="move-log-detail">{entry.detail}</span>
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
