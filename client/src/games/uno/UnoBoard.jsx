import React, { useEffect, useRef, useState } from 'react';
import { socket } from '../../socket';
import UnifiedVoiceWidget from '../../components/UnifiedVoiceWidget';
import { LogOut, Timer, RotateCcw, Bot as BotIcon, Layers, RefreshCw } from 'lucide-react';
import { playGameSound } from '../../audio';
import { useT } from '../../i18n/LanguageContext';

const COLORES = ['rojo', 'amarillo', 'verde', 'azul'];

/** Texto corto de una carta: el número, o el símbolo de la acción. */
function etiquetaDe(carta) {
  if (!carta) return '';
  if (carta.tipo === 'numero') return String(carta.valor);
  if (carta.tipo === 'salta') return '⊘';
  if (carta.tipo === 'cambio') return '⇄';
  if (carta.tipo === 'mas2') return '+2';
  if (carta.tipo === 'comodin') return '★';
  if (carta.tipo === 'comodin_mas4') return '+4';
  return '';
}

function Carta({ carta, color, jugable, seleccionable, onClick, etiquetaAria }) {
  const tono = carta ? (carta.color || color || 'comodin') : 'dorso';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!seleccionable}
      aria-label={etiquetaAria}
      className={`uno-card color-${tono} ${jugable ? 'jugable' : ''} ${seleccionable ? '' : 'inerte'}`}
    >
      <span className="uno-card-valor">{etiquetaDe(carta)}</span>
    </button>
  );
}

/**
 * Tablero de Uno. Registrado en `games/registry.js` bajo 'uno'.
 *
 * Toda la regla vive en el servidor: el cliente ni siquiera calcula qué cartas
 * son jugables — las recibe en `playableIndices`. Así no hay dos implementaciones
 * de las reglas que puedan discrepar.
 */
export default function UnoBoard({ gameState, playerId, onLeave }) {
  const { t } = useT();
  const [eligiendoColor, setEligiendoColor] = useState(null); // índice de la carta pendiente de color
  const [cantarUno, setCantarUno] = useState(false);
  const restante = useSegundosRestantes(gameState);

  const estadoPrevio = useRef(null);
  const status = gameState ? gameState.status : null;
  const ganadorRonda = gameState ? gameState.roundWinnerId : null;

  useEffect(() => {
    if (status && status !== estadoPrevio.current) {
      if (status === 'round_ended') playGameSound(ganadorRonda === playerId ? 'win_round' : 'pass');
      if (status === 'game_ended') playGameSound('win_game');
    }
    estadoPrevio.current = status;
  }, [status, ganadorRonda, playerId]);

  if (!gameState) return null;

  const {
    players = [],
    currentPlayerId,
    topCard,
    currentColor,
    direction = 1,
    pendingDraw = 0,
    deckCount = 0,
    playableIndices = [],
    roundNumber = 1,
    maxScore = 200,
    gameWinner
  } = gameState;

  const yo = players.find(p => p.id === playerId);
  const mano = (yo && yo.hand) || [];
  const esMiTurno = currentPlayerId === playerId && status === 'playing';
  const puedoJugarAlgo = playableIndices.length > 0;
  // Cantar es obligatorio al soltar la penúltima: se arma antes de jugarla.
  const puedeCantar = esMiTurno && mano.length === 2;

  const enviar = (actionType, payload = {}) => {
    socket.emit('game_action', { actionType, payload });
  };

  const jugar = (index) => {
    if (!esMiTurno || !playableIndices.includes(index)) return;
    const carta = mano[index];
    if (carta && !carta.color) {
      setEligiendoColor(index); // comodín: primero hay que elegir color
      return;
    }
    playGameSound('place');
    enviar('play', { index, uno: cantarUno });
    setCantarUno(false);
  };

  const confirmarColor = (color) => {
    playGameSound('place');
    enviar('play', { index: eligiendoColor, color, uno: cantarUno });
    setEligiendoColor(null);
    setCantarUno(false);
  };

  const robar = () => {
    playGameSound('draw');
    enviar('draw');
  };

  const pasar = () => {
    playGameSound('pass');
    enviar('pass');
  };

  const otraRonda = () => {
    playGameSound('shuffle');
    socket.emit(status === 'game_ended' ? 'start_game' : 'next_round', { roomId: gameState.roomId });
  };

  const nombreDe = (p) => (p.id === playerId ? t('uno.you') : p.name);

  return (
    <div className="uno-container">
      <div className="uno-header glass-panel">
        <div className="uno-brand">
          <Layers size={18} aria-hidden="true" />
          <span className="uno-title">{t('uno.title')}</span>
          <span className="uno-round">{t('uno.round', { n: roundNumber })}</span>
          <span className="uno-target">{t('uno.target', { n: maxScore })}</span>
        </div>

        <div className="uno-voice-slot">
          <UnifiedVoiceWidget variant="embedded" />
        </div>

        <button
          onClick={onLeave}
          className="uno-btn btn-exit"
          title={t('uno.leaveTitle')}
          aria-label={t('uno.leaveTitle')}
        >
          <LogOut size={16} aria-hidden="true" />
          <span>{t('uno.leave')}</span>
        </button>
      </div>

      {/* Rivales: cuántas cartas llevan y cuánto puntúan */}
      <div className="uno-players glass-panel">
        {players.map((p) => (
          <div
            key={p.id}
            className={`uno-player ${p.id === currentPlayerId && status === 'playing' ? 'en-turno' : ''}`}
          >
            <span className="uno-player-nombre">
              {nombreDe(p)}
              {p.isBot && <BotIcon size={11} aria-hidden="true" />}
            </span>
            <span className="uno-player-meta">
              <span className="uno-player-cartas" title={t('uno.cards', { n: p.handCount })}>
                {p.handCount}
              </span>
              <span className="uno-player-puntos">{p.score}</span>
              {p.handCount === 1 && <span className="uno-badge-uno">{t('uno.uno')}</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Mesa: descarte, color en juego, sentido y mazo */}
      <div className="uno-mesa">
        <div className="uno-mazo" title={t('uno.deck', { n: deckCount })}>
          <span className="uno-mazo-count">{deckCount}</span>
        </div>

        <div className="uno-descarte">
          <Carta carta={topCard} color={currentColor} seleccionable={false} etiquetaAria={t('uno.topCard')} />
          <span className={`uno-color-actual color-${currentColor}`} aria-label={t('uno.colorInPlay')}>
            {t(`uno.color.${currentColor}`)}
          </span>
        </div>

        <div className="uno-info">
          <span className="uno-sentido" title={t('uno.direction')}>
            <RefreshCw size={14} style={{ transform: direction === -1 ? 'scaleX(-1)' : 'none' }} aria-hidden="true" />
          </span>
          {pendingDraw > 0 && (
            <span className="uno-deuda" role="status">{t('uno.pendingDraw', { n: pendingDraw })}</span>
          )}
          {restante !== null && status === 'playing' && (
            <span className={`uno-reloj ${restante <= 5 ? 'urgente' : ''}`}>
              <Timer size={13} aria-hidden="true" />
              {t('uno.seconds', { n: restante })}
            </span>
          )}
        </div>
      </div>

      {/* Aviso de turno / resultado */}
      <div className="uno-status" role="status" aria-live="polite">
        {status === 'playing'
          ? (esMiTurno
            ? (pendingDraw > 0 && !puedoJugarAlgo
              ? t('uno.mustTake', { n: pendingDraw })
              : t('uno.yourTurn'))
            : t('uno.waitingRival'))
          : status === 'round_ended'
            ? t('uno.roundWon', { name: players.find(p => p.id === ganadorRonda)?.name || '' })
            : status === 'game_ended'
              ? t('uno.gameWon', { name: players.find(p => p.id === gameWinner)?.name || '' })
              : t('uno.waitingPlayers')}
      </div>

      {/* Mi mano */}
      <div className="uno-mano" role="group" aria-label={t('uno.yourHand')}>
        {mano.map((carta, idx) => (
          <Carta
            key={`${carta.tipo}-${carta.color}-${carta.valor}-${idx}`}
            carta={carta}
            jugable={esMiTurno && playableIndices.includes(idx)}
            seleccionable={esMiTurno && playableIndices.includes(idx)}
            onClick={() => jugar(idx)}
            etiquetaAria={t('uno.cardAria', {
              c: carta.color ? t(`uno.color.${carta.color}`) : t('uno.wild'),
              v: etiquetaDe(carta)
            })}
          />
        ))}
      </div>

      {/* Acciones */}
      <div className="uno-acciones">
        {status === 'playing' && esMiTurno && (
          <>
            <button onClick={robar} className="btn-premium btn-secondary">
              {pendingDraw > 0 ? t('uno.takeAll', { n: pendingDraw }) : t('uno.draw')}
            </button>
            {/* Pasar sólo tiene sentido tras robar una carta que sí podías jugar */}
            {puedoJugarAlgo && (
              <button onClick={pasar} className="btn-premium btn-secondary">{t('uno.pass')}</button>
            )}
            {puedeCantar && (
              <button
                onClick={() => setCantarUno(v => !v)}
                aria-pressed={cantarUno}
                className={`btn-premium uno-btn-cantar ${cantarUno ? 'armado' : ''}`}
                title={t('uno.declareHint')}
              >
                {t('uno.declare')}
              </button>
            )}
          </>
        )}

        {(status === 'round_ended' || status === 'game_ended') && (
          <button onClick={otraRonda} className="btn-premium btn-primary">
            <RotateCcw size={18} aria-hidden="true" />
            <span>{status === 'game_ended' ? t('uno.playAgain') : t('uno.nextRound')}</span>
          </button>
        )}
      </div>

      {/* Elegir color tras poner un comodín */}
      {eligiendoColor !== null && (
        <div className="uno-color-picker glass-panel" role="dialog" aria-label={t('uno.pickColor')}>
          <span className="uno-color-picker-title">{t('uno.pickColor')}</span>
          <div className="uno-color-picker-opciones">
            {COLORES.map((c) => (
              <button
                key={c}
                onClick={() => confirmarColor(c)}
                className={`uno-color-opcion color-${c}`}
                aria-label={t(`uno.color.${c}`)}
              >
                {t(`uno.color.${c}`)}
              </button>
            ))}
          </div>
          <button onClick={() => setEligiendoColor(null)} className="uno-color-cancelar">
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Cuenta atrás del turno, refrescada en el cliente (el servidor sólo manda el fin). */
function useSegundosRestantes(gameState) {
  const finTurno = gameState && gameState.status === 'playing' ? gameState.turnEndsAt : null;
  const [restante, setRestante] = useState(null);

  useEffect(() => {
    if (!finTurno) { setRestante(null); return undefined; }
    const tic = () => setRestante(Math.max(0, Math.ceil((finTurno - Date.now()) / 1000)));
    tic();
    const id = setInterval(tic, 1000);
    return () => clearInterval(id);
  }, [finTurno]);

  return restante;
}
