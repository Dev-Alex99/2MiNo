import React, { useEffect, useRef, useState } from 'react';
import { socket } from '../../socket';
import { LogOut, Timer, RotateCcw, Bot as BotIcon, Layers, RefreshCw, Sparkles, AlertCircle } from 'lucide-react';
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
  const [eligiendoColor, setEligiendoColor] = useState(null); // { index, uno } o null
  const [cantarUno, setCantarUno] = useState(false);
  const [confirmandoUno, setConfirmandoUno] = useState(null); // { index, carta }
  const [notificacionAccion, setNotificacionAccion] = useState(null); // { tipo, mensaje }
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

  // Escuchar lastAction para avisos de cantos y penalizaciones
  const accionPreviaRef = useRef(null);
  useEffect(() => {
    if (!gameState || !gameState.lastAction) return;
    const act = gameState.lastAction;
    if (act !== accionPreviaRef.current) {
      accionPreviaRef.current = act;
      const jugador = (gameState.players || []).find(p => p.id === act.playerId);
      const nombre = jugador ? (jugador.id === playerId ? t('uno.you') : jugador.name) : '';

      if (act.penalizadoPorNoCantar) {
        playGameSound('uno_penalty');
        setNotificacionAccion({
          tipo: 'penalizacion',
          mensaje: t('uno.penalizedToast', { name: nombre })
        });
        const timer = setTimeout(() => setNotificacionAccion(null), 3500);
        return () => clearTimeout(timer);
      } else if (act.cantoUno) {
        playGameSound('uno_call');
        setNotificacionAccion({
          tipo: 'canto',
          mensaje: t('uno.shoutedToast', { name: nombre })
        });
        const timer = setTimeout(() => setNotificacionAccion(null), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState?.lastAction, gameState?.players, playerId, t]);

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

  const ejecutarJugada = (index, cantar) => {
    const carta = mano[index];
    if (carta && !carta.color) {
      setEligiendoColor({ index, uno: cantar });
      setConfirmandoUno(null);
      return;
    }
    playGameSound('place');
    if (cantar) playGameSound('uno_call');
    enviar('play', { index, uno: cantar });
    setCantarUno(false);
    setConfirmandoUno(null);
  };

  const jugar = (index) => {
    if (!esMiTurno || !playableIndices.includes(index)) return;
    const carta = mano[index];

    // Si le quedan 2 cartas y no tiene armado cantarUno, preguntamos para protegerlo de la penalización
    if (mano.length === 2 && !cantarUno) {
      setConfirmandoUno({ index, carta });
      return;
    }

    ejecutarJugada(index, cantarUno);
  };

  const confirmarColor = (color) => {
    playGameSound('place');
    const index = typeof eligiendoColor === 'object' && eligiendoColor !== null ? eligiendoColor.index : eligiendoColor;
    const uno = typeof eligiendoColor === 'object' && eligiendoColor !== null ? eligiendoColor.uno : cantarUno;
    if (uno) playGameSound('uno_call');
    enviar('play', { index, color, uno });
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

        {/* Sin widget de voz duplicado: la superficie de la voz dentro de la
            partida es la cápsula anclada de `GameBar`, y es única. */}

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
                type="button"
                onClick={() => {
                  setCantarUno(v => {
                    const next = !v;
                    if (next) playGameSound('uno_call');
                    return next;
                  });
                }}
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

      {/* Diálogo preventivo: cantar UNO al jugar la penúltima */}
      {confirmandoUno !== null && (
        <div className="uno-prompt-overlay glass-panel animate-scale-up" role="dialog" aria-label={t('uno.promptTitle')}>
          <span className="uno-prompt-title">{t('uno.promptTitle')}</span>
          <div className="uno-prompt-buttons">
            <button
              type="button"
              onClick={() => ejecutarJugada(confirmandoUno.index, true)}
              className="btn-premium btn-primary uno-prompt-btn-cantar"
            >
              <Sparkles size={16} aria-hidden="true" />
              <span>{t('uno.promptCall')}</span>
            </button>
            <button
              type="button"
              onClick={() => ejecutarJugada(confirmandoUno.index, false)}
              className="btn-premium btn-secondary uno-prompt-btn-nocantar"
            >
              {t('uno.promptPlayOnly')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoUno(null)}
              className="uno-color-cancelar"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Notificación flotante de cantos y penalizaciones de UNO */}
      {notificacionAccion && (
        <div className={`uno-action-toast animate-fade-in ${notificacionAccion.tipo}`} role="status" aria-live="polite">
          {notificacionAccion.tipo === 'canto' ? (
            <Sparkles size={16} aria-hidden="true" />
          ) : (
            <AlertCircle size={16} aria-hidden="true" />
          )}
          <span>{notificacionAccion.mensaje}</span>
        </div>
      )}

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
