import React, { useState, useEffect } from 'react';
import { X, Trophy, Flame, RotateCcw, Award, ShieldCheck, Coins, Zap, History, Play, Target, Gift, CheckCircle2 } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { loadStats, ACHIEVEMENTS, winRate, getRank, getDivision, TITLES, getEquippedTitle, setEquippedTitle } from '../stats';
import { useGameStore } from '../store/useGameStore';
import ReplayModal from './ReplayModal';
import useModalA11y from '../hooks/useModalA11y';
import { useSocialStore, iniciarSocial, useCapacidades, hayPersistencia } from '../social/useSocialStore';

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
  const [equippedTitle, setEquippedTitleState] = useState(() => getEquippedTitle());
  const [history, setHistory] = useState([]);
  const [replayId, setReplayId] = useState(null);
  const [claiming, setClaiming] = useState(null);
  const [borrando, setBorrando] = useState(false);
  const pid = useGameStore((s) => s.cuentaId);

  // El perfil del servidor viene del store social: es quien escucha
  // `profile_data` de forma permanente y quien tiene el vigilante de 6 s. Antes
  // lo escuchaban tres componentes por separado y cada uno se quedaba sin datos
  // al desmontarse.
  const dbProfile = useSocialStore((s) => s.perfil);
  const estado = useSocialStore((s) => s.estado);
  const recargar = useSocialStore((s) => s.recargar);
  const conProgreso = hayPersistencia(useCapacidades());
  const daily = dbProfile?.daily;

  const { propsPanel, propsTitulo } = useModalA11y(onClose);

  const initials = (name || '?').trim().slice(0, 2).toUpperCase();
  const unlockedCount = ACHIEVEMENTS.filter(a => stats.achievements[a.id]).length;
  const rank = getRank(stats);

  useEffect(() => {
    iniciarSocial();
    socket.emit('get_match_history', { playerId: pid });

    function onHistory(data) {
      setHistory(Array.isArray(data) ? data : []);
    }
    function onMissionClaimed(res) {
      setClaiming(null);
      // Refrescar el perfil para reflejar monedas y estado de la misión.
      if (res && res.success) recargar();
    }
    socket.on('match_history_data', onHistory);
    socket.on('mission_claimed', onMissionClaimed);
    return () => {
      socket.off('match_history_data', onHistory);
      socket.off('mission_claimed', onMissionClaimed);
    };
  }, [pid, recargar]);

  const claimMission = (missionId) => {
    setClaiming(missionId);
    socket.emit('claim_mission', { playerId: pid, missionId });
  };

  // Confirmación EN LÍNEA, como el resto de lo destructivo del paquete: un
  // `window.confirm` es un diálogo del navegador que se lleva el foco fuera de
  // la app, no se puede traducir y no dice de qué perfil está hablando.
  const resetStats = () => {
    try { localStorage.removeItem('domino_stats'); } catch { /* noop */ }
    setStats(loadStats());
    setBorrando(false);
  };

  const handleSelectTitle = (titleId) => {
    setEquippedTitle(titleId);
    setEquippedTitleState(titleId);
  };

  /**
   * NO SE INVENTA UN DATO QUE NO EXISTE. Antes valían 1200 ELO y 500 monedas
   * cuando `profile_data` llegaba a null —que es un evento REAL, el que manda
   * un servidor sin persistencia—, y esas 500 monedas se pintaban con su icono
   * de moneda al lado mientras la tienda afirmaba 0 sobre el mismo monedero.
   * Ahora el valor ausente es «—» y el motivo va escrito en su franja.
   */
  const currentElo = dbProfile?.elo;
  const currentCoins = dbProfile?.coins;
  const elo = currentElo != null ? currentElo : '—';
  const monedas = currentCoins != null ? currentCoins : '—';

  return (
    <>
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up profile-card modal-a11y" {...propsPanel} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="profile-close" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} aria-hidden="true" />
        </button>

        {/* Cabecera: avatar + nombre + rango + ELO + monedas */}
        <div className="profile-head">
          <div className="profile-avatar">{initials}</div>
          <div style={{ flex: 1 }}>
            <div className="profile-name-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className="profile-name" {...propsTitulo}>{name || t('common.you')}</span>
              <span className="profile-rank-badge" style={{ borderColor: rank.color, color: rank.color }}>
                {t(`rank.${rank.id}`)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', fontSize: '0.8rem', color: '#9ca3af' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#818cf8', fontWeight: 700 }}>
                <Zap size={14} aria-hidden="true" /> {elo} ELO
              </span>
              {/* La división sale del ELO. Sin ELO no hay división que enseñar:
                  pintarla sobre el 1200 inventado era la misma mentira, sólo
                  que con insignia de color. */}
              {currentElo != null && (() => {
                const div = getDivision(currentElo);
                return (
                  <span className="profile-division-badge" style={{ color: div.color }} title={t(`div.${div.id}`)}>
                    {div.icon} {t(`div.${div.id}`)}
                  </span>
                );
              })()}
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#fbbf24', fontWeight: 700 }}>
                <Coins size={14} aria-hidden="true" /> {monedas} {t('common.coins')}
              </span>
            </div>

            {equippedTitle !== 'none' && (
              <div className="profile-equipped-title" style={{ marginTop: '4px' }}>
                {t(`title.${equippedTitle}`)}
              </div>
            )}
          </div>
        </div>

        {/* LA MISMA FRANJA QUE LA TIENDA, EL RANKING Y LA AGENDA, leída del
            MISMO dato (`capacidades.persistencia`). Un servidor sin base de
            datos no guarda ni monedas ni ELO; decirlo una vez vale más que tres
            pantallas contradiciéndose sobre el mismo monedero. */}
        {!conProgreso && (
          <p className="ov-degradado">{t('degradado.sinPersistencia')}</p>
        )}

        {/* Con persistencia pero sin respuesta: el vigilante de 6 s. El servidor
            puede aceptar el `get_profile` y no contestar nunca, y no hay ningún
            evento de error que lo cuente. */}
        {conProgreso && estado === 'sinDatos' && (
          <p className="ov-degradado">
            <span>{t('degradado.noCargado')}</span>
            <button type="button" className="btn-premium btn-secondary" onClick={recargar}>
              {t('degradado.reintentar')}
            </button>
          </p>
        )}

        {/* Cuerpo con Scroll Dedicado */}
        <div className="profile-scroll-body">
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
                        /* aria-disabled y rechazo en el manejador, nunca el
                           atributo `disabled`: una misión a medias es
                           exactamente el botón que hay que poder enfocar para
                           que el lector cuente cuánto falta. */
                        <button
                          type="button"
                          className="mission-claim-btn"
                          aria-disabled={(!m.completed || claiming === m.id) ? 'true' : undefined}
                          onClick={() => { if (m.completed && claiming !== m.id) claimMission(m.id); }}
                        >
                          <Gift size={12} aria-hidden="true" /> {m.reward}
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
                  /* Un título bloqueado seguía siendo `disabled`, así que se
                     salía del orden de tabulación y su `title` —el único sitio
                     donde ponía cuántas victorias faltan— no se anunciaba
                     nunca. Con aria-disabled se puede enfocar y el motivo entra
                     en el nombre accesible, que es donde se lee. */
                  <button
                    key={title.id}
                    type="button"
                    aria-disabled={isUnlocked ? undefined : 'true'}
                    aria-pressed={isSelected}
                    onClick={() => { if (isUnlocked) handleSelectTitle(title.id); }}
                    className={`profile-title-btn ${isSelected ? 'selected' : ''} ${!isUnlocked ? 'locked' : ''}`}
                    title={!isUnlocked ? t('profile.titleReq', { n: title.reqWins }) : undefined}
                    aria-label={isUnlocked ? undefined : `${t(`title.${title.id}`)} · ${t('profile.titleReq', { n: title.reqWins })}`}
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
            borrando ? (
              <div className="ov-confirmar" role="group" aria-label={t('profile.resetConfirm')}>
                <span className="ov-confirmar-texto">{t('profile.resetConfirm')}</span>
                <button type="button" className="btn-premium ov-peligro" onClick={resetStats}>
                  {t('profile.reset')}
                </button>
                <button type="button" className="btn-premium btn-secondary" onClick={() => setBorrando(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button type="button" className="profile-reset" onClick={() => setBorrando(true)}>
                <RotateCcw size={12} aria-hidden="true" /> {t('profile.reset')}
              </button>
            )
          )}
        </div>
      </div>
    </div>

    {/* LA REPETICIÓN NO CUELGA DEL PERFIL. Estaba dentro de este mismo
        `.modal-overlay`, así que un clic en SU fondo burbujeaba hasta el
        `onClick={onClose}` de aquí y cerraba los dos a la vez: se perdía el
        perfil por querer salir de un vídeo. Sale del overlay en el árbol de
        React —que es por donde burbujean los eventos sintéticos, portal
        incluido— y ella misma sale por portal en el DOM. */}
    {replayId && <ReplayModal matchId={replayId} onClose={() => setReplayId(null)} />}
    </>
  );
}
