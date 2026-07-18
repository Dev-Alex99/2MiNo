import React, { useState } from 'react';
import { X, Trophy, Flame, RotateCcw } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import { loadStats, ACHIEVEMENTS, winRate } from '../stats';

// Perfil del jugador: estadísticas y logros guardados localmente.
export default function ProfileModal({ name, onClose }) {
  const { t } = useT();
  // El estado se relee al abrir; un reinicio fuerza un re-render.
  const [stats, setStats] = useState(() => loadStats());

  const initials = (name || '?').trim().slice(0, 2).toUpperCase();
  const unlockedCount = ACHIEVEMENTS.filter(a => stats.achievements[a.id]).length;

  const resetStats = () => {
    if (!window.confirm(t('profile.resetConfirm'))) return;
    try { localStorage.removeItem('domino_stats'); } catch { /* noop */ }
    setStats(loadStats());
  };

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up profile-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-close" onClick={onClose} aria-label={t('common.cancel')}>
          <X size={18} />
        </button>

        {/* Cabecera: avatar + nombre */}
        <div className="profile-head">
          <div className="profile-avatar">{initials}</div>
          <div>
            <div className="profile-name">{name || t('common.you')}</div>
            <div className="profile-sub">{t('profile.title')}</div>
          </div>
        </div>

        {/* Estadísticas */}
        <div className="profile-stats-grid">
          <div className="profile-stat">
            <span className="profile-stat-num">{stats.wins}</span>
            <span className="profile-stat-label">{t('profile.wins')}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">{stats.losses}</span>
            <span className="profile-stat-label">{t('profile.losses')}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">{winRate(stats)}%</span>
            <span className="profile-stat-label">{t('profile.winrate')}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num"><Flame size={16} /> {stats.streak}</span>
            <span className="profile-stat-label">{t('profile.streak')}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">{stats.bestStreak}</span>
            <span className="profile-stat-label">{t('profile.best')}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">{stats.played}</span>
            <span className="profile-stat-label">{t('profile.played')}</span>
          </div>
        </div>

        {/* Logros */}
        <div className="profile-ach-header">
          <Trophy size={14} />
          {t('profile.achievements')}
          <span className="profile-ach-count">{unlockedCount}/{ACHIEVEMENTS.length}</span>
        </div>
        <div className="profile-ach-grid">
          {ACHIEVEMENTS.map(a => {
            const unlocked = !!stats.achievements[a.id];
            return (
              <div
                key={a.id}
                className={`profile-ach ${unlocked ? 'unlocked' : 'locked'}`}
                title={t(`ach.${a.id}.d`) + (unlocked ? ` · ${stats.achievements[a.id]}` : '')}
              >
                <span className="profile-ach-icon">{unlocked ? a.icon : '🔒'}</span>
                <span className="profile-ach-name">{t(`ach.${a.id}.n`)}</span>
              </div>
            );
          })}
        </div>

        {stats.played > 0 && (
          <button className="profile-reset" onClick={resetStats}>
            <RotateCcw size={12} /> {t('profile.reset')}
          </button>
        )}
      </div>
    </div>
  );
}
