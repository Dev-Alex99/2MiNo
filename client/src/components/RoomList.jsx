import React from 'react';
import { Users, Bot, Zap, Layers, RefreshCw, Globe, Trophy, Plus, WifiOff } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

/**
 * Salas públicas esperando gente. Llega en vivo por socket (el servidor la
 * reemite cada vez que alguien entra, sale o arranca una partida), así que no
 * hace falta sondear ni un botón de refrescar.
 */
export default function RoomList({ rooms, onJoin, loading, onCrear, sinConexion }) {
  const { t } = useT();

  // «No hay salas abiertas» y «no lo sabemos» no son lo mismo, y hasta ahora
  // se decían igual: sin socket la lista se queda vacía (o congelada en la
  // última que llegó) y el componente afirmaba que no había ninguna. Va
  // ANTES que `loading`, que sin conexión tampoco es verdad: no se está
  // buscando nada.
  if (sinConexion) {
    return (
      <div className="room-list-empty">
        <WifiOff size={13} aria-hidden="true" />
        {t('net.lost')}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="room-list-empty">
        <RefreshCw size={13} className="voice-spin" aria-hidden="true" />
        {t('rooms.searching')}
      </div>
    );
  }

  // El vacío lleva su salida. El texto ya sugería «crea una y aparecerás aquí»
  // y no había ningún botón para hacerlo sin bajar por el formulario entero.
  if (rooms.length === 0) {
    return (
      <div className="room-list-empty">
        <Globe size={13} aria-hidden="true" />
        {t('rooms.empty')}
        {onCrear && (
          <button type="button" className="room-list-salida" onClick={() => onCrear()}>
            <Plus size={13} aria-hidden="true" />
            {t('lobby.createRoom')}
          </button>
        )}
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
            {r.players}/{r.maxPlayers ?? 4}
          </span>
        </button>
      ))}
    </div>
  );
}
