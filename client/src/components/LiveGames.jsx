import React from 'react';
import { Eye, Zap, Layers } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

/**
 * Partidas públicas EN CURSO que se pueden ver como espectador. Llega en vivo
 * por socket (evento live_games), igual que la lista de salas abiertas.
 */
export default function LiveGames({ games = [], onWatch }) {
  const { t } = useT();

  if (games.length === 0) {
    return (
      <div className="room-list-empty">
        <Eye size={13} />
        {t('live.empty')}
      </div>
    );
  }

  return (
    <div className="room-list">
      {games.map((g) => (
        <button key={g.roomId} className="room-row" onClick={() => onWatch(g.roomId)}>
          <span className="room-row-main">
            <span className="room-row-host">{(g.players || []).join(' · ')}</span>
            <span className="room-row-tags">
              <span className="room-tag">
                <Layers size={9} />
                {t('opt.double', { n: g.maxPip })}
              </span>
              {g.teamsEnabled && <span className="room-tag">{t('rooms.teams')}</span>}
              {g.powersEnabled && (
                <span className="room-tag accent">
                  <Zap size={9} />
                  {t('rooms.powers')}
                </span>
              )}
              {g.spectators > 0 && (
                <span className="room-tag">
                  <Eye size={9} />
                  {t('live.watching', { n: g.spectators })}
                </span>
              )}
            </span>
          </span>

          <span className="room-row-count watch">
            <Eye size={11} />
            {t('live.watch')}
          </span>
        </button>
      ))}
    </div>
  );
}
