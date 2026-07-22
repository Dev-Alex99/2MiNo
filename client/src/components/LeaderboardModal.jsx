import React, { useState, useEffect } from 'react';
import { Trophy, X, Zap, CalendarDays, Globe2 } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { getDivision } from '../stats';

export default function LeaderboardModal({ onClose }) {
  const { t } = useT();
  const [scope, setScope] = useState('global');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    socket.emit('get_leaderboard', { scope });

    function onData(data) {
      // Compatibilidad: puede llegar un array plano o { scope, rows }.
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : []);
      if (!data || Array.isArray(data) || data.scope === scope) {
        setRows(list);
        setLoading(false);
      }
    }
    socket.on('leaderboard_data', onData);
    return () => socket.off('leaderboard_data', onData);
  }, [scope]);

  const isWeekly = scope === 'weekly';

  return (
    <div className="modal-overlay animate-fade-in" style={{ zIndex: 1200 }} onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up" style={{ maxWidth: '540px', width: '94%' }} onClick={e => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>

        <div className="modal-header-with-icon" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="modal-icon-circle winner" style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trophy size={24} color="#f59e0b" />
          </div>
          <div>
            <h2 className="modal-title" style={{ fontSize: '1.3rem', margin: 0 }}>{t('lb.title')}</h2>
            <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
              {isWeekly ? t('lb.subWeekly') : t('lb.subGlobal')}
            </span>
          </div>
        </div>

        {/* Pestañas Global / Semanal */}
        <div className="chat-tabs" style={{ marginTop: '14px' }}>
          <button className={`chat-tab-btn ${!isWeekly ? 'active' : ''}`} onClick={() => setScope('global')}>
            <Globe2 size={13} /> {t('lb.global')}
          </button>
          <button className={`chat-tab-btn ${isWeekly ? 'active' : ''}`} onClick={() => setScope('weekly')}>
            <CalendarDays size={13} /> {t('lb.weekly')}
          </button>
        </div>

        <div style={{ marginTop: '14px', maxHeight: '380px', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>{t('lb.loading')}</div>
          ) : rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>{t('lb.empty')}</div>
          ) : (
            <table className="leaderboard-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>#</th>
                  <th style={{ padding: '8px' }}>{t('lb.player')}</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>{isWeekly ? t('lb.weekWins') : t('lb.wins')}</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>{t('lb.elo')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((player, index) => {
                  const rank = index + 1;
                  const div = getDivision(player.elo);
                  return (
                    <tr key={player.id || index} style={{
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      background: rank === 1 ? 'rgba(245, 158, 11, 0.1)' : 'transparent'
                    }}>
                      <td style={{ padding: '10px 8px', fontWeight: 700 }}>
                        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
                      </td>
                      <td style={{ padding: '10px 8px', fontWeight: 600, color: rank === 1 ? '#f59e0b' : '#fff' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{player.username}</span>
                          <span title={t(`div.${div.id}`)} style={{
                            fontSize: '0.62rem', fontWeight: 800, color: div.color,
                            border: `1px solid ${div.color}`, borderRadius: '6px', padding: '1px 5px',
                            whiteSpace: 'nowrap'
                          }}>
                            {div.icon} {t(`div.${div.id}`)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: '#10b981', fontWeight: 700 }}>
                        {player.wins || 0}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#6366f1', whiteSpace: 'nowrap' }}>
                        <Zap size={11} style={{ verticalAlign: '-1px' }} /> {player.elo || 1200}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
