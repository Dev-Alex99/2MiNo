import React, { useState, useEffect } from 'react';
import { Trophy, RefreshCw, ChevronRight, Award, Eye } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';

export default function EndGameModal({ gameState, playerId }) {
  const { t } = useT();
  // "Ver tablero": el jugador oculta el resultado para inspeccionar la mesa
  // (y la última ficha jugada, que queda resaltada) y vuelve cuando quiera.
  const [peek, setPeek] = useState(false);
  // Pequeño margen antes de mostrar el diálogo: da tiempo a ver aterrizar la
  // ficha final en lugar de taparla al instante.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 900);
    return () => clearTimeout(id);
  }, []);

  // Nombres de equipo traducidos en cliente (el servidor ya no manda el texto).
  const teamLabel = (i) => (i === 0 ? t('team.a') : t('team.b'));
  const {
    status, roundWinner, gameWinner, players,
    teamsEnabled,
    roundWinnerTeam, gameWinnerTeam
  } = gameState;

  // Si no ha terminado ni la ronda ni el juego, no mostrar nada
  if (status !== 'round_ended' && status !== 'game_ended') return null;
  // Aún dentro del margen inicial: dejamos ver el tablero un momento.
  if (!ready) return null;

  // Modo "ver tablero": el diálogo se colapsa en una pastilla flotante que no
  // tapa la mesa; se pulsa para recuperar el resultado.
  if (peek) {
    return (
      <button className="end-peek-pill" onClick={() => setPeek(false)}>
        <Trophy size={14} />
        {t('end.showResult')}
      </button>
    );
  }

  const isGameEnd = status === 'game_ended';
  const winner = players.find(p => p.id === (isGameEnd ? gameWinner : roundWinner));
  const me = players.find(p => p.id === playerId);

  // En parejas gana un EQUIPO: gameWinner vale "team_0", no un id de jugador.
  const winningTeam = isGameEnd ? gameWinnerTeam : roundWinnerTeam;
  const isTeamWin = teamsEnabled && winningTeam !== null && winningTeam !== undefined;
  const isMeWinner = isTeamWin
    ? me?.team === winningTeam
    : winner?.id === playerId;

  // Cómo se llama el ganador en pantalla
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
                    <span className="modal-row-score">{p.score} pts</span>
                  </div>
                );
              })}
        </div>

        {/* Botón de acción */}
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

        {/* Ver el tablero final sin cerrar la partida */}
        <button className="end-view-board" onClick={() => setPeek(true)}>
          <Eye size={14} />
          {t('end.viewBoard')}
        </button>

      </div>
    </div>
  );
}
