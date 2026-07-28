import React, { useEffect, useRef } from 'react';
import { socket } from '../../socket';
import UnifiedVoiceWidget from '../../components/UnifiedVoiceWidget';
import { RotateCcw, LogOut, Sparkles, Bot as BotIcon, Timer } from 'lucide-react';
import { playGameSound } from '../../audio';
import { useT } from '../../i18n/LanguageContext';

/**
 * Tablero de tres en raya. Registrado en `games/registry.js` bajo 'tictactoe'.
 *
 * Recibe el contrato común de los tableros del hub; usa `gameState`, `playerId`
 * y `onLeave`, y no necesita el resto.
 */
export default function TicTacToeBoard({ gameState, playerId, onLeave }) {
  const { t } = useT();

  // El estado anterior se guarda para detectar el final de partida UNA vez y
  // sonar en consecuencia. Los hooks van siempre antes de cualquier return.
  const estadoPrevio = useRef(null);
  const restante = useSegundosRestantes(gameState);

  const status = gameState ? gameState.status : null;
  const winner = gameState ? gameState.winner : null;
  const miSimbolo = gameState && gameState.symbols ? gameState.symbols[playerId] : null;

  useEffect(() => {
    if (status === 'game_ended' && estadoPrevio.current !== 'game_ended') {
      if (winner === 'draw') playGameSound('pass');
      else playGameSound(winner === miSimbolo ? 'win_game' : 'win_round');
    }
    estadoPrevio.current = status;
  }, [status, winner, miSimbolo]);

  if (!gameState) return null;

  const {
    board = Array(9).fill(null),
    currentPlayerId,
    symbols = {},
    winningLine,
    scores = { X: 0, O: 0 },
    players = [],
    roundNumber = 1
  } = gameState;

  const esMiTurno = currentPlayerId === playerId;

  const jugar = (index) => {
    if (status !== 'playing' || !esMiTurno || board[index] !== null) return;
    playGameSound('place');
    socket.emit('game_action', { actionType: 'move', payload: { index } });
  };

  const otraRonda = () => {
    playGameSound('shuffle');
    socket.emit('start_game');
  };

  const jugadorDe = (simbolo) => players.find(p => symbols[p.id] === simbolo) || null;
  const jugadorX = jugadorDe('X');
  const jugadorO = jugadorDe('O');

  const nombreDe = (jugador) => {
    if (!jugador) return t('ttt.waitingPlayer');
    return jugador.id === playerId ? t('ttt.you') : jugador.name;
  };

  const tarjeta = (simbolo, jugador) => (
    <div className={`tictactoe-player-card ${currentPlayerId === jugador?.id && status === 'playing' ? 'active-turn' : ''}`}>
      <div className={`player-badge symbol-${simbolo.toLowerCase()}`}>{simbolo}</div>
      <div className="player-meta">
        <span className="player-name">
          {nombreDe(jugador)}
          {jugador?.isBot && <BotIcon size={12} aria-hidden="true" />}
        </span>
        <span className="player-score">{t('ttt.wins', { n: scores[simbolo] || 0 })}</span>
      </div>
    </div>
  );

  return (
    <div className="tictactoe-container">
      <div className="tictactoe-header glass-panel">
        <div className="tictactoe-brand">
          <Sparkles size={18} aria-hidden="true" />
          <span className="tictactoe-title">{t('ttt.title')}</span>
          <span className="tictactoe-round">{t('ttt.round', { n: roundNumber })}</span>
        </div>

        <div className="tictactoe-voice-slot">
          <UnifiedVoiceWidget variant="embedded" />
        </div>

        <div className="tictactoe-actions">
          <button
            onClick={onLeave}
            className="tictactoe-btn btn-exit"
            title={t('ttt.leaveTitle')}
            aria-label={t('ttt.leaveTitle')}
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{t('ttt.leave')}</span>
          </button>
        </div>
      </div>

      <div className="tictactoe-score-bar glass-panel">
        {tarjeta('X', jugadorX)}
        <div className="tictactoe-vs">{t('ttt.vs')}</div>
        {tarjeta('O', jugadorO)}
      </div>

      {/* El turno CADUCA y el servidor juega por ti. Sin reloj no había forma de
          saberlo: se veía como una jugada que aparecía sola. */}
      <div className="tictactoe-status-banner" role="status" aria-live="polite">
        {status === 'playing' ? (
          <>
            <span className={`turn-tag ${esMiTurno ? 'my-turn' : 'opponent-turn'}`}>
              {esMiTurno ? t('ttt.yourTurn', { s: miSimbolo || '' }) : t('ttt.rivalTurn')}
            </span>
            {restante !== null && (
              <span className={`tictactoe-clock ${restante <= 5 ? 'urgent' : ''}`}>
                <Timer size={13} aria-hidden="true" />
                {t('ttt.timeLeft', { n: restante })}
              </span>
            )}
          </>
        ) : status === 'game_ended' ? (
          <span className={`result-tag ${winner === 'draw' ? 'draw' : 'winner'}`}>
            {winner === 'draw'
              ? t('ttt.draw')
              : winner === miSimbolo
                ? t('ttt.youWin')
                : t('ttt.youLose', { name: jugadorDe(winner)?.name || winner })}
          </span>
        ) : (
          <span className="turn-tag waiting">{t('ttt.waitingPlayers')}</span>
        )}
      </div>

      <div className="tictactoe-board-wrapper">
        <div className="tictactoe-grid" role="grid" aria-label={t('ttt.title')}>
          {board.map((celda, idx) => (
            <button
              key={idx}
              onClick={() => jugar(idx)}
              disabled={status !== 'playing' || !esMiTurno || celda !== null}
              className={`tictactoe-cell ${celda ? `cell-${celda.toLowerCase()}` : ''} ${winningLine && winningLine.includes(idx) ? 'winning-cell' : ''}`}
              // Sin esto, un lector de pantalla anunciaba nueve botones vacíos.
              aria-label={celda
                ? t('ttt.cellTaken', { n: idx + 1, s: celda })
                : t('ttt.cell', { n: idx + 1 })}
            >
              {celda && <span className={`symbol-render ${celda.toLowerCase()}-render`}>{celda}</span>}
            </button>
          ))}
        </div>
      </div>

      {status === 'game_ended' && (
        <div className="tictactoe-footer-actions animate-scale-up">
          <button onClick={otraRonda} className="btn-premium btn-primary btn-replay">
            <RotateCcw size={18} aria-hidden="true" />
            <span>{t('ttt.playAgain')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Segundos que quedan de turno, refrescados cada segundo en el cliente.
 *
 * El servidor manda `turnEndsAt` (marca absoluta) y `turnSecondsRemaining`, pero
 * ese valor sólo se actualiza cuando llega un `game_state`: sin este contador el
 * número se quedaría clavado hasta la siguiente jugada.
 */
function useSegundosRestantes(gameState) {
  const finTurno = gameState && gameState.status === 'playing' ? gameState.turnEndsAt : null;
  const [restante, setRestante] = React.useState(null);

  useEffect(() => {
    if (!finTurno) { setRestante(null); return undefined; }
    const tic = () => setRestante(Math.max(0, Math.ceil((finTurno - Date.now()) / 1000)));
    tic();
    const id = setInterval(tic, 1000);
    return () => clearInterval(id);
  }, [finTurno]);

  return restante;
}
