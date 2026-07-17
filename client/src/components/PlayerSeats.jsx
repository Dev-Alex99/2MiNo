import React, { useEffect, useRef } from 'react';
import { Bot, Mic, Shield, Zap } from 'lucide-react';
import { useVoice } from '../voice/VoiceContext';

/**
 * Los rivales colocados alrededor del tablero, como en una mesa real.
 *
 * Sustituye a la barra lateral en móvil: allí costaba 173px de los ~640 de alto,
 * y aquí no cuesta nada porque va flotando sobre el tablero.
 *
 * El sitio se deduce del ORDEN DE TURNOS, no del array: el siguiente en jugar
 * va a tu derecha, el de después arriba y el último a tu izquierda. Con eso, en
 * parejas tu compañero (que juega dos turnos después) te queda siempre enfrente,
 * igual que en la mesa de verdad.
 */
const SEAT_BY_OFFSET = { 1: 'right', 2: 'top', 3: 'left' };

function initials(name) {
  return name.substring(0, 2).toUpperCase();
}

function SeatVideo({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="seat-video" />;
}

/**
 * Un asiento, memoizado. Recibe solo primitivas (y el stream, que es una ref
 * estable cuando no cambia). Así, cuando alguien empieza o deja de hablar y el
 * contexto de voz se re-renderiza, React salta todos los asientos MENOS el que
 * de verdad cambió su `talking`. El resto no vuelve a pintarse.
 */
const Seat = React.memo(function Seat({
  id, pos, name, isBot, teamClass, isActive, talking,
  stream, shieldActive, inVoice, handCount, powersCount, showPowers,
  targeting, onSelect
}) {
  return (
    <div
      className={`seat seat-${pos} ${isActive ? 'active' : ''} ${teamClass} ${
        talking ? 'talking' : ''
      } ${targeting ? 'targetable' : ''}`}
      onClick={targeting ? () => onSelect(id) : undefined}
      role={targeting ? 'button' : undefined}
    >
      <div className="seat-face">
        {stream ? <SeatVideo stream={stream} /> : (
          <span className="seat-avatar">
            {isBot ? <Bot size={13} /> : initials(name)}
          </span>
        )}
        {shieldActive && <Shield size={9} className="seat-shield" />}
        {inVoice && !stream && <Mic size={8} className="seat-mic" />}
      </div>

      <span className="seat-name">{name}</span>

      {/* Las fichas en la mano, como barritas: se ve de un vistazo quién está a
          punto de cerrar, sin tener que leer un número. */}
      <div className="seat-tiles" title={`${handCount} fichas`}>
        {Array.from({ length: Math.min(handCount, 10) }).map((_, i) => (
          <i key={i} />
        ))}
        <span className="seat-count">{handCount}</span>

        {showPowers && powersCount > 0 && (
          <span className="seat-powers" title={`${powersCount} cartas de poder`}>
            <Zap size={8} />
            {powersCount}
          </span>
        )}
      </div>

      {targeting && <span className="seat-target">🎯</span>}
    </div>
  );
});

export default function PlayerSeats({
  players,
  playerId,
  currentPlayerId,
  teamsEnabled,
  powersEnabled,
  pendingTargetType,
  onSelectPlayerTarget
}) {
  const voice = useVoice();
  const remoteVideos = voice ? voice.remoteVideos : {};
  const speaking = voice ? voice.speaking : {};

  const meIndex = players.findIndex((p) => p.id === playerId);
  if (meIndex === -1) return null;

  const n = players.length;
  const seats = [];
  for (let offset = 1; offset < n; offset++) {
    const player = players[(meIndex + offset) % n];
    // Cara a cara cuando solo sois dos: enfrente se lee mejor que a un lado.
    const pos = n === 2 ? 'top' : SEAT_BY_OFFSET[offset];
    if (pos) seats.push({ player, pos });
  }

  const targeting =
    pendingTargetType === 'player_target' || pendingTargetType === 'smuggle_select_player';

  return (
    <>
      {seats.map(({ player, pos }) => (
        <Seat
          key={player.id}
          id={player.id}
          pos={pos}
          name={player.name}
          isBot={player.isBot}
          teamClass={teamsEnabled ? `team-${player.team}` : ''}
          isActive={player.id === currentPlayerId}
          talking={!!speaking[player.id]}
          stream={player.camOn ? remoteVideos[player.id] || null : null}
          shieldActive={player.shieldActive}
          inVoice={player.inVoice}
          handCount={player.handCount}
          powersCount={player.powersCount}
          showPowers={powersEnabled}
          targeting={targeting}
          onSelect={onSelectPlayerTarget}
        />
      ))}
    </>
  );
}
