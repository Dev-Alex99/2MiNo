import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX, LogOut, Layers, Timer } from 'lucide-react';
import { toggleMute, getMuteState } from '../audio';
import VoiceChat from './VoiceChat';

/**
 * Barra única de la partida, en móvil y en escritorio.
 *
 * Sustituye a la barra lateral de 320px: con los asientos alrededor del tablero
 * mostrando nombre, fichas, turno y cara, el marcador lateral repetía lo mismo
 * ocupando un tercio de la pantalla.
 *
 * También se traga el indicador de turno, que antes flotaba sobre el tablero y
 * solapaba con los asientos y los controles de zoom.
 */
export default function GameBar({
  players, playerId, roundNumber, teamsEnabled, teamScores, maxScore, onLeave,
  currentPlayerId, turnEndsAt, turnSecondsRemaining, turnDurationSeconds = 30
}) {
  const [muted, setMuted] = useState(getMuteState());
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Cuenta atrás local: el servidor manda los segundos ya calculados y
  // turnEndsAt cambia en cada rearme, así que basta resincronizar ahí.
  const [secondsLeft, setSecondsLeft] = useState(turnSecondsRemaining);
  useEffect(() => {
    setSecondsLeft(turnSecondsRemaining);
  }, [turnSecondsRemaining, turnEndsAt, currentPlayerId]);
  useEffect(() => {
    if (turnSecondsRemaining == null) return undefined;
    const id = setInterval(() => {
      setSecondsLeft(s => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [turnSecondsRemaining, turnEndsAt, currentPlayerId]);

  const me = players.find(p => p.id === playerId);
  const active = players.find(p => p.id === currentPlayerId);
  const isMyTurn = currentPlayerId === playerId;
  const showTimer = secondsLeft != null;
  const urgent = showTimer && secondsLeft <= 10;

  return (
    <div className="game-bar">
      <span className="game-bar-round">
        <Layers size={11} />
        R{roundNumber || 1}
      </span>

      {teamsEnabled ? (
        <span className="game-bar-score">
          <b className="team-0">{teamScores[0]}</b>
          <span className="game-bar-sep">–</span>
          <b className="team-1">{teamScores[1]}</b>
        </span>
      ) : (
        <span className="game-bar-score">
          <b>{me ? me.score : 0}</b>
          <span className="game-bar-sep">/{maxScore}</span>
        </span>
      )}

      {/* De quién es el turno. El asiento del jugador ya se ilumina, así que
          aquí lo importante es el reloj. */}
      {active && (
        <span className={`game-bar-turn ${isMyTurn ? 'mine' : ''} ${urgent ? 'urgent' : ''}`}>
          <span className="turn-pulse-dot" />
          <span className="game-bar-turn-name">{isMyTurn ? 'Tu turno' : active.name}</span>
          {showTimer && (
            <span className="game-bar-timer">
              <Timer size={10} />
              {secondsLeft}s
            </span>
          )}
        </span>
      )}

      <div className="game-bar-actions">
        <VoiceChat playerId={playerId} players={players} />

        <button
          onClick={() => setMuted(toggleMute())}
          className={`mute-btn ${muted ? 'active' : ''}`}
          title={muted ? 'Activar sonido' : 'Silenciar sonido'}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>

        <button
          onClick={() => setConfirmLeave(v => !v)}
          className={`mute-btn ${confirmLeave ? 'active' : ''}`}
          title="Salir de la sala"
          aria-label="Salir de la sala"
        >
          <LogOut size={14} />
        </button>
      </div>

      {confirmLeave && (
        <div className="leave-confirm bar-leave">
          <span className="leave-confirm-text">
            ¿Abandonar? Un bot ocupará tu sitio y los demás seguirán jugando.
          </span>
          <div className="leave-confirm-actions">
            <button onClick={onLeave} className="leave-confirm-yes">Salir</button>
            <button onClick={() => setConfirmLeave(false)} className="leave-confirm-no">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
