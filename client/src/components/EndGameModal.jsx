import React from 'react';
import { Trophy, RefreshCw, ChevronRight, Award, AwardIcon } from 'lucide-react';
import { socket } from '../socket';

export default function EndGameModal({ gameState, playerId }) {
  const { status, roundWinner, gameWinner, players } = gameState;

  // Si no ha terminado ni la ronda ni el juego, no mostrar nada
  if (status !== 'round_ended' && status !== 'game_ended') return null;

  const isGameEnd = status === 'game_ended';
  const winner = players.find(p => p.id === (isGameEnd ? gameWinner : roundWinner));
  const isMeWinner = winner?.id === playerId;

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
                ¡Partida Completada!
              </span>
              <h2 className="modal-title">
                {isMeWinner ? '¡Felicidades, Ganaste!' : `Ganador: ${winner?.name}`}
              </h2>
            </div>

            <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>
              Has alcanzado el límite de 100 puntos y has conquistado la mesa de dominó.
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
                Fin de la Ronda
              </span>
              <h2 className="modal-title" style={{ fontSize: '1.4rem' }}>
                {roundWinner === 'tie' ? '¡Ronda Empatada (Tranca)!' : (isMeWinner ? '¡Ganaste la Ronda!' : `Ronda para: ${winner?.name}`)}
              </h2>
            </div>

            {roundWinner !== 'tie' && (
              <div className="modal-desc-box">
                Suma de manos enemigas añadida al marcador global.
              </div>
            )}
          </>
        )}

        {/* Tabla de Puntuaciones al finalizar */}
        <div className="modal-table">
          <span className="modal-table-title">
            Marcador General
          </span>
          {players.map(p => {
            const isWinner = p.id === winner?.id;
            return (
              <div 
                key={p.id} 
                className={`modal-table-row ${isWinner ? 'highlight' : ''}`}
              >
                <span className="modal-row-name">
                  {isWinner && <Award size={14} style={{ color: '#f59e0b' }} />}
                  {p.name} {p.id === playerId && '(Tú)'}
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
              Jugar de Nuevo
            </>
          ) : (
            <>
              Siguiente Ronda
              <ChevronRight size={18} />
            </>
          )}
        </button>

      </div>
    </div>
  );
}
