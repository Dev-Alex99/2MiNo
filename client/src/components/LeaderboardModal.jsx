import React, { useState, useEffect } from 'react';
import { Trophy, X } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';

export default function LeaderboardModal({ onClose }) {
  const { t } = useT();
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    socket.emit('get_leaderboard');
    function onLeaderboardData(data) {
      setLeaderboard(Array.isArray(data) ? data : []);
      setLoading(false);
    }
    socket.on('leaderboard_data', onLeaderboardData);
    return () => socket.off('leaderboard_data', onLeaderboardData);
  }, []);

  return (
    <div className="modal-overlay animate-fade-in" style={{ zIndex: 1200 }}>
      <div className="modal-card glass-panel animate-scale-up" style={{ maxWidth: '520px', width: '92%' }}>
        <button className="modal-close-btn" onClick={onClose}>
          <X size={18} />
        </button>

        <div className="modal-header-with-icon" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="modal-icon-circle winner" style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trophy size={24} color="#f59e0b" />
          </div>
          <div>
            <h2 className="modal-title" style={{ fontSize: '1.3rem', margin: 0 }}>
              Ranking Global Supabase
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
              Mejores jugadores en vivo
            </span>
          </div>
        </div>

        <div style={{ marginTop: '16px', maxHeight: '360px', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>
              Cargando tabla de clasificación...
            </div>
          ) : leaderboard.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>
              Aún no hay partidas registradas en el ranking. ¡Sé el primero en ganar!
            </div>
          ) : (
            <table className="leaderboard-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>#</th>
                  <th style={{ padding: '8px' }}>Jugador</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Victorias</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Puntos</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>ELO</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((player, index) => {
                  const rank = index + 1;
                  return (
                    <tr
                      key={player.id || index}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        background: rank === 1 ? 'rgba(245, 158, 11, 0.1)' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '10px 8px', fontWeight: 700 }}>
                        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
                      </td>
                      <td style={{ padding: '10px 8px', fontWeight: 600, color: rank === 1 ? '#f59e0b' : '#fff' }}>
                        {player.username}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: '#10b981', fontWeight: 700 }}>
                        {player.wins || 0}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: '#9ca3af' }}>
                        {player.points_scored || 0}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#6366f1' }}>
                        ⚡{player.elo || 1200}
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
