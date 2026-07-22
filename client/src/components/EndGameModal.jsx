import React, { useState, useEffect } from 'react';
import { Trophy, RefreshCw, ChevronRight, Award, Eye } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';

import { playGameSound } from '../audio';

function ConfettiCanvas() {
  const canvasRef = React.useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = (canvas.width = window.innerWidth);
    const h = (canvas.height = window.innerHeight);

    const isMobile = w < 640;
    const particleCount = isMobile ? 35 : 60;
    const colors = ['#10b981', '#34d399', '#f59e0b', '#fbbf24', '#6366f1', '#ec4899', '#3b82f6'];

    const particles = Array.from({ length: particleCount }).map(() => ({
      x: Math.random() * w,
      y: Math.random() * h - h,
      r: Math.random() * 5 + 3,
      d: Math.random() * 20 + 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 10,
      tiltAngleIncremental: Math.random() * 0.07 + 0.04,
      tiltAngle: Math.random() * Math.PI
    }));

    let animationFrameId;
    const startTime = Date.now();
    const DURATION = 6000;

    const render = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > DURATION) {
        ctx.clearRect(0, 0, w, h);
        return;
      }

      ctx.clearRect(0, 0, w, h);
      particles.forEach((p) => {
        p.tiltAngle += p.tiltAngleIncremental;
        p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
        p.tilt = Math.sin(p.tiltAngle) * 12;

        if (p.y > h) {
          p.x = Math.random() * w;
          p.y = -15;
          p.tilt = Math.random() * 10 - 10;
        }

        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
        ctx.stroke();
      });
      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 200
      }}
    />
  );
}

export default function EndGameModal({ gameState, playerId, tournamentMatch = false }) {
  const { t } = useT();
  const [peek, setPeek] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 4100);
    return () => clearTimeout(id);
  }, []);

  const teamLabel = (i) => (i === 0 ? t('team.a') : t('team.b'));
  const {
    status, roundWinner, gameWinner, players,
    teamsEnabled,
    roundWinnerTeam, gameWinnerTeam
  } = gameState;

  if (status !== 'round_ended' && status !== 'game_ended') return null;
  if (!ready) return null;

  const isGameEnd = status === 'game_ended';
  const winner = players.find(p => p.id === (isGameEnd ? gameWinner : roundWinner));
  const me = players.find(p => p.id === playerId);

  const winningTeam = isGameEnd ? gameWinnerTeam : roundWinnerTeam;
  const isTeamWin = teamsEnabled && winningTeam !== null && winningTeam !== undefined;
  const isMeWinner = isTeamWin
    ? me?.team === winningTeam
    : winner?.id === playerId;

  if (peek) {
    return (
      <>
        {isMeWinner && <ConfettiCanvas />}
        <button className="end-peek-pill" onClick={() => setPeek(false)}>
          <Trophy size={14} />
          {t('end.showResult')}
        </button>
      </>
    );
  }

  const winnerLabel = isTeamWin ? teamLabel(winningTeam) : winner?.name;

  const handleNextAction = () => {
    if (isGameEnd) {
      socket.emit('play_again', { roomId: gameState.roomId });
    } else {
      socket.emit('next_round', { roomId: gameState.roomId });
    }
  };

  return (
    <div className="modal-overlay animate-fade-in">
      {isMeWinner && <ConfettiCanvas />}
      <div className="modal-card glass-panel animate-scale-up">
        
        {/* Luces traseras de victoria */}
        <div 
          className="modal-glow-line" 
          style={{
            background: isMeWinner 
              ? 'linear-gradient(90deg, transparent, #10b981, transparent)' 
              : 'linear-gradient(90deg, transparent, #6366f1, transparent)'
          }}
        />

        {isGameEnd ? (
          /* PANTALLA FIN DE JUEGO */
          <>
            <div className="modal-icon-circle winner">
              <Trophy size={48} />
            </div>

            <div className="modal-title-box">
              <span className="modal-meta-label">
                {t('end.gameDone')}
              </span>
              <h2 className="modal-title">
                {isMeWinner ? t('end.congrats') : t('end.winner', { name: winnerLabel })}
              </h2>
            </div>

            <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>
              {t('end.reached', { n: gameState.maxScore })}
            </p>
          </>
        ) : (
          /* PANTALLA FIN DE RONDA */
          <>
            <div className="modal-icon-circle round">
              <Award size={36} />
            </div>

            <div className="modal-title-box">
              <span className="modal-meta-label">
                {t('end.roundEnd')}
              </span>
              <h2 className="modal-title" style={{ fontSize: '1.4rem' }}>
                {roundWinner === 'tie'
                  ? t('end.roundTie')
                  : (isMeWinner ? t('end.roundWon') : t('end.roundFor', { name: winnerLabel }))}
              </h2>
            </div>

            {roundWinner !== 'tie' && (
              <div className="modal-desc-box">
                {t('end.roundDesc')}
              </div>
            )}
          </>
        )}

        {/* Tabla de Puntuaciones al finalizar. En parejas puntúa el equipo,
            así que el marcador individual no significa nada aquí. */}
        <div className="modal-table">
          <span className="modal-table-title">{t('end.scoreboard')}</span>

          {teamsEnabled
            ? [0, 1].map(tm => (
                <div key={tm} className={`modal-table-row ${tm === winningTeam ? 'highlight' : ''}`}>
                  <span className="modal-row-name">
                    {tm === winningTeam && <Award size={14} style={{ color: '#f59e0b' }} />}
                    {teamLabel(tm)} {tm === me?.team && `(${t('common.you')})`}
                    <span className="modal-row-members">
                      {players.filter(p => p.team === tm).map(p => p.name).join(' · ')}
                    </span>
                  </span>
                  <span className="modal-row-score">{gameState.teamScores?.[tm] ?? 0} {t('common.points')}</span>
                </div>
              ))
            : players.map(p => {
                const isWinner = p.id === winner?.id;
                return (
                  <div
                    key={p.id}
                    className={`modal-table-row ${isWinner ? 'highlight' : ''}`}
                  >
                    <span className="modal-row-name">
                      {isWinner && <Award size={14} style={{ color: '#f59e0b' }} />}
                      {p.name} {p.id === playerId && `(${t('common.you')})`}
                    </span>
                    <span className="modal-row-score">{p.score} {t('common.points')}</span>
                  </div>
                );
              })}
        </div>

        {/* Botón de acción. En torneo, al terminar el juego el servidor avanza el
            cuadro automáticamente, así que se muestra un aviso en vez de "jugar de nuevo". */}
        {tournamentMatch && isGameEnd ? (
          <div className="tourney-advance-note" style={{ width: '100%', padding: '14px', marginTop: '10px', textAlign: 'center' }}>
            <RefreshCw size={16} className="voice-spin" /> {t('tourney.advancing')}
          </div>
        ) : (
          <button
            onClick={handleNextAction}
            className="btn-premium btn-primary"
            style={{ width: '100%', padding: '16px', fontSize: '1rem', marginTop: '10px' }}
          >
            {isGameEnd ? (
              <>
                <RefreshCw size={18} />
                {t('end.playAgain')}
              </>
            ) : (
              <>
                {t('end.nextRound')}
                <ChevronRight size={18} />
              </>
            )}
          </button>
        )}

        {/* Ver el tablero final sin cerrar la partida */}
        <button className="end-view-board" onClick={() => setPeek(true)}>
          <Eye size={14} />
          {t('end.viewBoard')}
        </button>

      </div>
    </div>
  );
}
