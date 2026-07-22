import React from 'react';
import { Users, Bot, Zap, Layers, RefreshCw, Globe, Trophy } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

/**
 * Salas públicas esperando gente. Llega en vivo por socket (el servidor la
 * reemite cada vez que alguien entra, sale o arranca una partida), así que no
 * hace falta sondear ni un botón de refrescar.
 */
export default function RoomList({ rooms, onJoin, loading }) {
  const { t } = useT();
  if (loading) {
    return (
      <div className="room-list-empty">
        <RefreshCw size={13} className="voice-spin" />
        {t('rooms.searching')}
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div className="room-list-empty">
        <Globe size={13} />
        {t('rooms.empty')}
      </div>
    );
  }

  return (
    <div className="room-list">
      {rooms.map((r) => (
        <button key={r.roomId} className="room-row" onClick={() => onJoin(r.roomId)}>
          <span className="room-row-main">
            <span className="room-row-host">{r.host}</span>
            <span className="room-row-tags">
              <span className="room-tag">
                <Layers size={9} />
                {t('opt.double', { n: r.maxPip })}
              </span>
              {r.ranked && (
                <span className="room-tag ranked">
                  <Trophy size={9} />
                  {t('lobby.rankedBadge')}
                </span>
              )}
              {r.teamsEnabled && <span className="room-tag">{t('rooms.teams')}</span>}
              {r.powersEnabled && (
                <span className="room-tag accent">
                  <Zap size={9} />
                  {t('rooms.powers')}
                </span>
              )}
              {!r.drawEnabled && <span className="room-tag">{t('rooms.noDraw')}</span>}
              {r.bots > 0 && (
                <span className="room-tag">
                  <Bot size={9} />
                  {r.bots}
                </span>
              )}
            </span>
          </span>

          <span className="room-row-count">
            <Users size={11} />
            {r.players}/4
          </span>
        </button>
      ))}
    </div>
  );
}
