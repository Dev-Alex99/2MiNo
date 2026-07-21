import React, { useState, useEffect } from 'react';
import { X, Trophy, Flame, RotateCcw, Award, ShieldCheck, Coins, Zap } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { loadStats, ACHIEVEMENTS, winRate, getRank, TITLES, getEquippedTitle, setEquippedTitle } from '../stats';
import { getOrCreatePersistentPlayerId } from '../store/useGameStore';

export default function ProfileModal({ name, onClose }) {
  const { t } = useT();
  const [stats, setStats] = useState(() => loadStats());
  const [dbProfile, setDbProfile] = useState(null);
  const [equippedTitle, setEquippedTitleState] = useState(() => getEquippedTitle());

  const initials = (name || '?').trim().slice(0, 2).toUpperCase();
  const unlockedCount = ACHIEVEMENTS.filter(a => stats.achievements[a.id]).length;
  const rank = getRank(stats);

  useEffect(() => {
    const pid = getOrCreatePersistentPlayerId();
    socket.emit('get_profile', { playerId: pid, username: name || 'Jugador' });

    function onProfileData(data) {
      if (data) setDbProfile(data);
    }
    socket.on('profile_data', onProfileData);
    return () => socket.off('profile_data', onProfileData);
  }, [name]);

  const resetStats = () => {
    if (!window.confirm(t('profile.resetConfirm'))) return;
    try { localStorage.removeItem('domino_stats'); } catch { /* noop */ }
    setStats(loadStats());
  };

  const handleSelectTitle = (titleId) => {
    setEquippedTitle(titleId);
    setEquippedTitleState(titleId);
  };

  const currentElo = dbProfile?.elo || 1200;
  const currentCoins = dbProfile?.coins !== undefined ? dbProfile.coins : 500;

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up profile-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-close" onClick={onClose} aria-label={t('common.cancel')}>
          <X size={18} />
        </button>

        {/* Cabecera: avatar + nombre + rango + ELO + monedas */}
        <div className="profile-head" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="profile-avatar">{initials}</div>
          <div style={{ flex: 1 }}>
            <div className="profile-name-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className="profile-name">{name || t('common.you')}</span>
              <span className="profile-rank-badge" style={{ borderColor: rank.color, color: rank.color }}>
                {t(`rank.${rank.id}`)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', fontSize: '0.8rem', color: '#9ca3af' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#818cf8', fontWeight: 700 }}>
                <Zap size={14} /> {currentElo} ELO
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#fbbf24', fontWeight: 700 }}>
                <Coins size={14} /> {currentCoins} Doblones
              </span>
            </div>

            {equippedTitle !== 'none' && (
              <div className="profile-equipped-title" style={{ marginTop: '4px' }}>
                {t(`title.${equippedTitle}`)}
              </div>
            )}
          </div>
        </div>

        {/* Selector de Títulos */}
        <div className="profile-titles-section">
          <div className="profile-section-label">
            <Award size={14} />
            {t('profile.titles')}
          </div>
          <div className="profile-titles-grid">
            {TITLES.map((title) => {
              const isUnlocked = stats.wins >= title.reqWins;
              const isSelected = equippedTitle === title.id;
              return (
                <button
                  key={title.id}
                  disabled={!isUnlocked}
                  onClick={() => handleSelectTitle(title.id)}
                  className={`profile-title-btn ${isSelected ? 'selected' : ''} ${!isUnlocked ? 'locked' : ''}`}
                  title={!isUnlocked ? `Requiere ${title.reqWins} victoria(s)` : undefined}
                >
                  <span className="title-icon">{title.icon}</span>
                  <span className="title-text">{t(`title.${title.id}`)}</span>
                </button>
              );
            })}
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
