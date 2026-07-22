import React, { useState, useEffect } from 'react';
import { X, Trophy, Flame, RotateCcw, Award, ShieldCheck, Coins, Zap, History, Play, Target, Gift, CheckCircle2 } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { loadStats, ACHIEVEMENTS, winRate, getRank, getDivision, TITLES, getEquippedTitle, setEquippedTitle } from '../stats';
import { getOrCreatePersistentPlayerId } from '../store/useGameStore';
import ReplayModal from './ReplayModal';

// Resultado de una partida para el jugador actual (individual o parejas).
function matchResult(row, pid) {
  const wid = row.winner_id;
  if (!wid || wid === 'tie') return 'tie';
  if (row.teams_enabled) {
    const me = (row.final_scores || []).find(e => e.id === pid);
    return me && me.team != null && `team_${me.team}` === wid ? 'win' : 'loss';
  }
  return wid === pid ? 'win' : 'loss';
}

export default function ProfileModal({ name, onClose }) {
  const { t } = useT();
  const [stats, setStats] = useState(() => loadStats());
  const [dbProfile, setDbProfile] = useState(null);
  const [equippedTitle, setEquippedTitleState] = useState(() => getEquippedTitle());
  const [history, setHistory] = useState([]);
  const [replayId, setReplayId] = useState(null);
  const [claiming, setClaiming] = useState(null);
  const pid = getOrCreatePersistentPlayerId();
  const daily = dbProfile?.daily;

  const initials = (name || '?').trim().slice(0, 2).toUpperCase();
  const unlockedCount = ACHIEVEMENTS.filter(a => stats.achievements[a.id]).length;
  const rank = getRank(stats);

  useEffect(() => {
    socket.emit('get_profile', { playerId: pid, username: name || 'Jugador' });
    socket.emit('get_match_history', { playerId: pid });

    function onProfileData(data) {
      if (data) setDbProfile(data);
    }
    function onHistory(data) {
      setHistory(Array.isArray(data) ? data : []);
    }
    function onMissionClaimed(res) {
      setClaiming(null);
      if (res && res.success) {
        // Refrescar el perfil para reflejar monedas y estado de la misión.
        socket.emit('get_profile', { playerId: pid, username: name || 'Jugador' });
      }
    }
    socket.on('profile_data', onProfileData);
    socket.on('match_history_data', onHistory);
    socket.on('mission_claimed', onMissionClaimed);
    return () => {
      socket.off('profile_data', onProfileData);
      socket.off('match_history_data', onHistory);
      socket.off('mission_claimed', onMissionClaimed);
    };
  }, [name, pid]);

  const claimMission = (missionId) => {
    setClaiming(missionId);
    socket.emit('claim_mission', { playerId: pid, missionId });
  };

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
              {(() => {
                const div = getDivision(currentElo);
                return (
                  <span className="profile-division-badge" style={{ color: div.color }} title={t(`div.${div.id}`)}>
                    {div.icon} {t(`div.${div.id}`)}
                  </span>
                );
              })()}
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#fbbf24', fontWeight: 700 }}>
                <Coins size={14} /> {currentCoins} {t('common.coins')}
              </span>
            </div>

            {equippedTitle !== 'none' && (
              <div className="profile-equipped-title" style={{ marginTop: '4px' }}>
                {t(`title.${equippedTitle}`)}
              </div>
            )}
          </div>
        </div>

        {/* Misiones diarias + racha */}
        {daily && Array.isArray(daily.missions) && daily.missions.length > 0 && (
          <div className="profile-missions-section">
            <div className="profile-section-label">
              <Target size={14} />
              {t('mission.title')}
              <span className="mission-streak-badge">
                <Flame size={12} /> {t('mission.streak', { n: daily.streak || 0 })}
              </span>
            </div>
            <div className="mission-list">
              {daily.missions.map(m => {
                const pct = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
                return (
                  <div key={m.id} className={`mission-row ${m.completed ? 'done' : ''}`}>
                    <div className="mission-info">
                      <span className="mission-name">{t(`mission.${m.type}`, { n: m.target })}</span>
                      <div className="mission-bar">
                        <div className="mission-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="mission-progress-txt">{m.progress}/{m.target}</span>
                    </div>
                    {m.claimed ? (
                      <span className="mission-claimed"><CheckCircle2 size={13} /> {t('mission.claimed')}</span>
                    ) : (
                      <button
                        className="mission-claim-btn"
                        disabled={!m.completed || claiming === m.id}
                        onClick={() => claimMission(m.id)}
                      >
                        <Gift size={12} /> {m.reward}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
                  title={!isUnlocked ? t('profile.titleReq', { n: title.reqWins }) : undefined}
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

        {/* Historial de partidas + repeticiones */}
        {history.length > 0 && (
          <div className="profile-history-section">
            <div className="profile-ach-header">
              <History size={14} />
              {t('history.title')}
            </div>
            <div className="profile-history-list">
              {history.map(row => {
                const res = matchResult(row, pid);
                // Rivales: en parejas excluye a tu compañero (mismo equipo), no solo a ti.
                const myEntry = (row.final_scores || []).find(e => e.id === pid);
                const opponents = (row.final_scores || [])
                  .filter(e => e.id !== pid && (!row.teams_enabled || !myEntry || e.team !== myEntry.team))
                  .map(e => e.name)
                  .join(', ');
                const dateStr = row.played_at
                  ? new Date(row.played_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
                  : '';
                return (
                  <div key={row.id} className="profile-history-row">
                    <span className={`history-result-badge ${res}`}>{t(`history.${res}`)}</span>
                    <div className="history-row-main">
                      <span className="history-row-opp">{opponents || '—'}</span>
                      <span className="history-row-meta">
                        {row.teams_enabled ? t('history.teams') : t('history.solo')} · {dateStr}
                      </span>
                    </div>
                    <button className="history-watch-btn" onClick={() => setReplayId(row.id)}>
                      <Play size={12} /> {t('history.watch')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {stats.played > 0 && (
          <button className="profile-reset" onClick={resetStats}>
            <RotateCcw size={12} /> {t('profile.reset')}
          </button>
        )}
      </div>

      {replayId && <ReplayModal matchId={replayId} onClose={() => setReplayId(null)} />}
    </div>
  );
}
