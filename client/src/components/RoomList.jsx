import React from 'react';
import { Users, Bot, Zap, Layers, RefreshCw, Globe } from 'lucide-react';

/**
 * Salas públicas esperando gente. Llega en vivo por socket (el servidor la
 * reemite cada vez que alguien entra, sale o arranca una partida), así que no
 * hace falta sondear ni un botón de refrescar.
 */
export default function RoomList({ rooms, onJoin, loading }) {
  if (loading) {
    return (
      <div className="room-list-empty">
        <RefreshCw size={13} className="voice-spin" />
        Buscando salas…
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div className="room-list-empty">
        <Globe size={13} />
        No hay salas abiertas ahora mismo. Crea una y aparecerás aquí.
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
                Doble {r.maxPip}
              </span>
              {r.teamsEnabled && <span className="room-tag">Parejas</span>}
              {r.powersEnabled && (
                <span className="room-tag accent">
                  <Zap size={9} />
                  Poderes
                </span>
              )}
              {!r.drawEnabled && <span className="room-tag">Sin pozo</span>}
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
