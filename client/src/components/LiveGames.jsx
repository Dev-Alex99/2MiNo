import React from 'react';
import { Eye, Zap, Layers, Play, WifiOff } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

/**
 * Partidas públicas EN CURSO que se pueden ver como espectador. Llega en vivo
 * por socket (evento live_games), igual que la lista de salas abiertas.
 *
 * El estado vacío de abajo llevaba desde siempre sin poder verse: el lobby
 * montaba el componente con `{liveGames.length > 0 && …}` delante, así que la
 * única rama que podía renderizarse era la que nunca se daba.
 */
export default function LiveGames({ games = [], onWatch, onJugar, sinConexion }) {
  const { t } = useT();

  // Sin socket la lista está vacía porque no ha llegado, no porque no haya
  // partidas. Decir «no hay partidas en vivo» ahí es la misma mentira que el
  // contador de jugadores en línea que afirmaba 1 con el servidor caído.
  if (sinConexion) {
    return (
      <div className="room-list-empty">
        <WifiOff size={13} aria-hidden="true" />
        {t('net.lost')}
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="room-list-empty">
        <Eye size={13} aria-hidden="true" />
        {t('live.empty')}
        {onJugar && (
          <button type="button" className="room-list-salida" onClick={() => onJugar()}>
            <Play size={13} fill="currentColor" aria-hidden="true" />
            {t('lobby.playNow')}
          </button>
        )}
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
