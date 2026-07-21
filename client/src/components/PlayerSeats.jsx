import React, { useEffect, useRef } from 'react';
import { Bot, Mic, Shield, Zap } from 'lucide-react';
import { useVoice } from '../voice/VoiceContext';
import { useT } from '../i18n/LanguageContext';

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

const STATIC_TILE_ICONS = Array.from({ length: 15 }).map((_, i) => <i key={i} />);

const Seat = React.memo(function Seat({
  id, pos, name, isBot, teamClass, isActive, talking,
  stream, shieldActive, inVoice, handCount, powersCount, showPowers,
  targeting, isLeader, taunt, blitzTime, onSelect
}) {
  const { t } = useT();

  const tMsg = (key, params) => {
    if (!params) return t(key);
    const p = { ...params };
    for (const k in p) if (p[k] === '@opponent') p[k] = t('srv.opponent');
    return t(key, p);
  };

  return (
    <div
      className={`seat seat-${pos} ${isActive ? 'active' : ''} ${teamClass} ${
        talking ? 'talking' : ''
      } ${targeting ? 'targetable' : ''}`}
      onClick={targeting ? () => onSelect(id) : undefined}
      role={targeting ? 'button' : undefined}
    >
      {taunt && (
        <div className="seat-taunt-bubble animate-taunt-float">
          <span className="taunt-text">
            {taunt.playerName ? <strong>{taunt.playerName}: </strong> : null}
            {taunt.msgKey ? tMsg(taunt.msgKey, taunt.params) : taunt.text}
          </span>
        </div>
      )}

      <div className="seat-face">
        {talking && (
          <div className="voice-spectrum-ring-container">
            <div className="voice-spectrum-ring ring-1" />
            <div className="voice-spectrum-ring ring-2" />
            <div className="voice-spectrum-ring ring-3" />
          </div>
        )}
        {isLeader && <span className="seat-crown" title="Líder del Marcador">👑</span>}
        {stream ? <SeatVideo stream={stream} /> : (
          <span className="seat-avatar">
            {isBot ? <Bot size={13} /> : initials(name)}
          </span>
        )}
        {shieldActive && <Shield size={9} className="seat-shield" />}
        {inVoice && !stream && <Mic size={8} className="seat-mic" />}
      </div>

      <span className="seat-name">
        {name}
        {blitzTime !== undefined && (
          <span className={`seat-blitz-badge ${blitzTime <= 10 ? 'critical' : ''}`}>
            ⚡{blitzTime}s
          </span>
        )}
      </span>

      <div className="seat-tiles" title={t('seat.tiles', { n: handCount })}>
        {STATIC_TILE_ICONS.slice(0, Math.min(handCount, 10))}
        <span className="seat-count">{handCount}</span>

        {showPowers && powersCount > 0 && (
          <span className="seat-powers" title={t('seat.powers', { n: powersCount })}>
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
  onSelectPlayerTarget,
  quickNotifications = [],
  blitzTimeRemaining
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
    const pos = n === 2 ? 'top' : SEAT_BY_OFFSET[offset];
    if (pos) seats.push({ player, pos });
  }

  const targeting =
    pendingTargetType === 'player_target' || pendingTargetType === 'smuggle_select_player';

  const maxScore = players.reduce((m, p) => Math.max(m, p.score || 0), 0);
  const leaderId = maxScore > 0 ? (players.find(p => p.score === maxScore) || {}).id : null;

  return (
    <>
      {seats.map(({ player, pos }) => {
        const taunt = (quickNotifications || []).slice().reverse().find(
          (notif) => notif.playerName === player.name || notif.playerId === player.id
        );

        return (
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
            isLeader={player.id === leaderId}
            taunt={taunt}
            blitzTime={blitzTimeRemaining ? blitzTimeRemaining[player.id] : undefined}
            onSelect={onSelectPlayerTarget}
          />
        );
      })}
    </>
  );
}
