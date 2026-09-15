import React, { useState, useEffect } from 'react';
import { Trophy, X, Zap, CalendarDays, Globe2 } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { getDivision } from '../stats';
import useModalA11y from '../hooks/useModalA11y';
import { useCapacidades, hayPersistencia, ESPERA_MAXIMA_MS } from '../social/useSocialStore';

export default function LeaderboardModal({ onClose }) {
  const { t } = useT();
  const [scope, setScope] = useState('global');
  const [rows, setRows] = useState([]);
  // 'cargando' | 'listo' | 'sinDatos'; el tercero es el vigilante vencido.
  const [estado, setEstado] = useState('cargando');
  const [intento, setIntento] = useState(0);
  const conProgreso = hayPersistencia(useCapacidades());

  const { propsPanel, propsTitulo } = useModalA11y(onClose);

  useEffect(() => {
    setEstado('cargando');
    socket.emit('get_leaderboard', { scope });

    function onData(data) {
      // Compatibilidad: puede llegar un array plano o { scope, rows }.
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : []);
      if (!data || Array.isArray(data) || data.scope === scope) {
        setRows(list);
        setEstado('listo');
      }
    }
    socket.on('leaderboard_data', onData);
    // El MISMO vigilante de 6 s que el resto de pantallas sociales: sin él, un
    // servidor que acepta la petición y no contesta deja el «Cargando…» girando
    // para siempre, porque no hay evento de error que lo apague.
    const vigilante = setTimeout(() => setEstado((e) => (e === 'cargando' ? 'sinDatos' : e)), ESPERA_MAXIMA_MS);
    return () => {
      clearTimeout(vigilante);
      socket.off('leaderboard_data', onData);
    };
  }, [scope, intento]);

  const isWeekly = scope === 'weekly';

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div
        className="modal-card glass-panel animate-scale-up modal-a11y ov-ranking"
        {...propsPanel}
        onClick={e => e.stopPropagation()}
      >
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} aria-hidden="true" />
        </button>

        <div className="modal-header-with-icon" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="modal-icon-circle winner" style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trophy size={24} color="#f59e0b" aria-hidden="true" />
          </div>
          <div>
            <h2 className="modal-title" style={{ fontSize: '1.3rem', margin: 0 }} {...propsTitulo}>{t('lb.title')}</h2>
            <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
              {isWeekly ? t('lb.subWeekly') : t('lb.subGlobal')}
            </span>
          </div>
        </div>

        {/* La misma franja y el mismo dato que el perfil, la tienda y la agenda. */}
        {!conProgreso && <p className="ov-degradado">{t('degradado.sinRanking')}</p>}

        {/* Pestañas Global / Semanal */}
        <div className="chat-tabs" style={{ marginTop: '14px' }}>
          <button type="button" className={`chat-tab-btn ${!isWeekly ? 'active' : ''}`} aria-pressed={!isWeekly} onClick={() => setScope('global')}>
            <Globe2 size={13} aria-hidden="true" /> {t('lb.global')}
          </button>
          <button type="button" className={`chat-tab-btn ${isWeekly ? 'active' : ''}`} aria-pressed={isWeekly} onClick={() => setScope('weekly')}>
            <CalendarDays size={13} aria-hidden="true" /> {t('lb.weekly')}
          </button>
        </div>

        <div className="ov-ranking-cuerpo">
          {estado === 'cargando' ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>{t('lb.loading')}</div>
          ) : estado === 'sinDatos' ? (
            <div className="ov-vacio">
              <p>{t('degradado.noCargado')}</p>
              <button type="button" className="btn-premium btn-secondary" onClick={() => setIntento((n) => n + 1)}>
                {t('degradado.reintentar')}
              </button>
            </div>
          ) : rows.length === 0 ? (
            /* Un vacío con salida: la tabla está vacía porque nadie ha jugado
               todavía, y la acción siguiente es exactamente jugar. Cerrar el
               ranking es lo que devuelve al hub, así que ese es el botón. */
            <div className="ov-vacio">
              <p>{conProgreso ? t('lb.empty') : t('degradado.sinRanking')}</p>
              <button type="button" className="btn-premium btn-primary" onClick={onClose}>
                {t('hub.jugar')}
              </button>
            </div>
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
                        {/* Sin ELO no se rellena con 1200: una fila del ranking
                            con un ELO inventado ordena mal y miente igual. */}
                        <Zap size={11} style={{ verticalAlign: '-1px' }} aria-hidden="true" /> {player.elo != null ? player.elo : '—'}
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
