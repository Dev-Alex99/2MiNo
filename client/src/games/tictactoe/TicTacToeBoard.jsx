import React from 'react';
import { socket } from '../../socket';
import { useT } from '../../i18n/LanguageContext';
import UnifiedVoiceWidget from '../../components/UnifiedVoiceWidget';
import { RotateCcw, LogOut, Trophy, Sparkles, User, Bot as BotIcon } from 'lucide-react';
import { playGameSound } from '../../audio';

export default function TicTacToeBoard({ gameState, playerId, onLeave }) {
  const { t } = useT();

  if (!gameState) return null;

  const {
    board = Array(9).fill(null),
    status,
    currentPlayerId,
    symbols = {},
    winner,
    winningLine,
    scores = { X: 0, O: 0 },
    players = [],
    roundNumber = 1
  } = gameState;

  const isMyTurn = currentPlayerId === playerId;
  const mySymbol = symbols[playerId] || null;

  const handleCellClick = (index) => {
    if (status !== 'playing' || !isMyTurn || board[index] !== null) return;
    playGameSound('tile_play');
    socket.emit('game_action', {
      actionType: 'move',
      payload: { index }
    });
  };

  const handleRestart = () => {
    playGameSound('button_click');
    socket.emit('start_game');
  };

  const getPlayerBySymbol = (sym) => {
    return players.find(p => symbols[p.id] === sym) || null;
  };

  const playerX = getPlayerBySymbol('X');
  const playerO = getPlayerBySymbol('O');

  return (
    <div className="tictactoe-container">
      {/* Cabecera del Juego con Voz Integrada */}
      <div className="tictactoe-header glass-panel">
        <div className="tictactoe-brand">
          <Sparkles size={18} className="text-amber-400 animate-pulse" />
          <span className="tictactoe-title">Tres en Raya</span>
          <span className="tictactoe-round">Ronda {roundNumber}</span>
        </div>

        {/* Voz Unificada en Cabecera */}
        <div className="tictactoe-voice-slot">
          <UnifiedVoiceWidget variant="embedded" />
        </div>

        <div className="tictactoe-actions">
          <button onClick={onLeave} className="tictactoe-btn btn-exit" title="Salir al Lobby">
            <LogOut size={16} />
            <span>Salir</span>
          </button>
        </div>
      </div>

      {/* Marcador de Jugadores X y O */}
      <div className="tictactoe-score-bar glass-panel">
        {/* Jugador X */}
        <div className={`tictactoe-player-card ${currentPlayerId === playerX?.id && status === 'playing' ? 'active-turn' : ''}`}>
          <div className="player-badge symbol-x">X</div>
          <div className="player-meta">
            <span className="player-name">
              {playerX ? playerX.name : 'Esperando...'}
              {playerX?.isBot && <BotIcon size={12} className="inline ml-1 text-slate-400" />}
            </span>
            <span className="player-score">Victorias: {scores.X || 0}</span>
          </div>
        </div>

        <div className="tictactoe-vs">VS</div>

        {/* Jugador O */}
        <div className={`tictactoe-player-card ${currentPlayerId === playerO?.id && status === 'playing' ? 'active-turn' : ''}`}>
          <div className="player-badge symbol-o">O</div>
          <div className="player-meta">
            <span className="player-name">
              {playerO ? playerO.name : 'Esperando...'}
              {playerO?.isBot && <BotIcon size={12} className="inline ml-1 text-slate-400" />}
            </span>
            <span className="player-score">Victorias: {scores.O || 0}</span>
          </div>
        </div>
      </div>

      {/* Cartel de Turno / Resultado */}
      <div className="tictactoe-status-banner">
        {status === 'playing' ? (
          isMyTurn ? (
            <span className="turn-tag my-turn animate-bounce">¡Tu Turno! ({mySymbol})</span>
          ) : (
            <span className="turn-tag opponent-turn">Turno del Rival...</span>
          )
        ) : status === 'game_ended' ? (
          winner === 'draw' ? (
            <span className="result-tag draw">¡Empate! (Gato)</span>
          ) : (
            <span className="result-tag winner">
              🏆 ¡Ganador: {getPlayerBySymbol(winner)?.name || winner}!
            </span>
          )
        ) : (
          <span className="turn-tag waiting">Esperando jugadores...</span>
        )}
      </div>

      {/* Tablero 3x3 */}
      <div className="tictactoe-board-wrapper">
        <div className="tictactoe-grid">
          {board.map((cell, idx) => {
            const isWinningCell = winningLine && winningLine.includes(idx);
            return (
              <button
                key={idx}
                onClick={() => handleCellClick(idx)}
                disabled={status !== 'playing' || !isMyTurn || cell !== null}
                className={`tictactoe-cell ${cell ? `cell-${cell.toLowerCase()}` : ''} ${isWinningCell ? 'winning-cell' : ''}`}
              >
                {cell === 'X' && <span className="symbol-render x-render">X</span>}
                {cell === 'O' && <span className="symbol-render o-render">O</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Acciones de Fin de Ronda */}
      {status === 'game_ended' && (
        <div className="tictactoe-footer-actions animate-scale-up">
          <button onClick={handleRestart} className="btn-premium btn-primary btn-replay">
            <RotateCcw size={18} />
            <span>Jugar Otra Ronda</span>
          </button>
        </div>
      )}
    </div>
  );
}
