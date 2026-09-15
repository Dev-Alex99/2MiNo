import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, SkipBack, SkipForward, Rewind, Trophy, Gauge } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import useModalA11y from '../hooks/useModalA11y';
import DominoTile from './DominoTile';

// Reconstruye el estado del tablero después de cada entrada del registro.
// states[i] = tablero tras procesar las primeras i jugadas del move_log.
function buildStates(moveLog) {
  const states = [{ chain: [], leftEnd: null, rightEnd: null }];
  let chain = [];
  let leftEnd = null;
  let rightEnd = null;

  for (const mv of moveLog) {
    if (mv && mv.action === 'play' && Array.isArray(mv.tile)) {
      const tile = mv.tile;
      if (chain.length === 0) {
        chain = [[tile[0], tile[1]]];
        leftEnd = tile[0];
        rightEnd = tile[1];
      } else if (mv.side === 'left') {
        const oriented = tile[1] === leftEnd ? [tile[0], tile[1]] : [tile[1], tile[0]];
        chain = [oriented, ...chain];
        leftEnd = oriented[0];
      } else {
        // 'right' o desconocido → se trata como extremo derecho
        const oriented = tile[0] === rightEnd ? [tile[0], tile[1]] : [tile[1], tile[0]];
        chain = [...chain, oriented];
        rightEnd = oriented[1];
      }
    }
    states.push({ chain: chain.map(t => [...t]), leftEnd, rightEnd });
  }
  return states;
}

export default function ReplayModal({ matchId, onClose }) {
  const { t } = useT();
  const [replay, setReplay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const boardRef = useRef(null);
  const { propsPanel, propsTitulo } = useModalA11y(onClose);

  useEffect(() => {
    setLoading(true);
    setReplay(null);
    setStep(0);
    setPlaying(false);
    socket.emit('get_match_replay', { matchId });
    function onData(data) {
      setReplay(data);
      setLoading(false);
    }
    socket.on('match_replay_data', onData);
    return () => socket.off('match_replay_data', onData);
  }, [matchId]);

  const moveLog = useMemo(() => (Array.isArray(replay?.move_log) ? replay.move_log : []), [replay]);
  const states = useMemo(() => buildStates(moveLog), [moveLog]);
  const maxStep = moveLog.length;

  const currentState = states[step] || states[0];
  const currentMove = step > 0 ? moveLog[step - 1] : null;

  // Auto-reproducción
  useEffect(() => {
    if (!playing) return;
    if (step >= maxStep) { setPlaying(false); return; }
    const id = setTimeout(() => setStep(s => Math.min(maxStep, s + 1)), 1100 / speed);
    return () => clearTimeout(id);
  }, [playing, step, maxStep, speed]);

  // Auto-scroll hacia el extremo donde ocurrió la última jugada mostrada
  // (izquierda si fue jugada por la izquierda; si no, al extremo derecho).
  useEffect(() => {
    if (!boardRef.current) return;
    const mv = step > 0 ? moveLog[step - 1] : null;
    boardRef.current.scrollLeft = mv && mv.side === 'left' ? 0 : boardRef.current.scrollWidth;
  }, [step, moveLog]);

  const togglePlay = useCallback(() => {
    if (step >= maxStep) setStep(0);
    setPlaying(p => !p);
  }, [step, maxStep]);

  const finalScores = Array.isArray(replay?.final_scores) ? replay.final_scores : [];

  // Descripción de la jugada actual
  const moveCaption = () => {
    if (!currentMove) return t('replay.start');
    const who = currentMove.player;
    if (currentMove.action === 'play' && Array.isArray(currentMove.tile)) {
      const sideTxt = currentMove.side === 'left' ? t('board.left') : t('board.right');
      return t('replay.played', { name: who, tile: `${currentMove.tile[0]}|${currentMove.tile[1]}`, side: sideTxt });
    }
    if (currentMove.action === 'draw') return t('replay.drew', { name: who });
    if (currentMove.action === 'pass') return t('replay.passed', { name: who });
    return `${who}: ${currentMove.detail || ''}`;
  };

  /**
   * SALE POR PORTAL. Se renderizaba dentro del `.modal-overlay` del perfil, así
   * que un clic en SU fondo burbujeaba hasta el `onClose` del perfil y cerraba
   * los dos: para salir de una repetición había que perder el perfil entero.
   * Con el portal tampoco hereda el `overflow: hidden` de la tarjeta del perfil,
   * que le recortaba el tablero reconstruido.
   */
  return createPortal(
    <div className="modal-overlay ov-sobre-modal animate-fade-in" onClick={onClose}>
      <div
        className="modal-card glass-panel animate-scale-up modal-a11y ov-repeticion"
        {...propsPanel}
        onClick={e => e.stopPropagation()}
      >
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} aria-hidden="true" />
        </button>

        {/* Cabecera */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <div className="modal-icon-circle winner" style={{ width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Play size={20} color="#f59e0b" aria-hidden="true" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 className="modal-title" style={{ fontSize: '1.15rem', margin: 0 }} {...propsTitulo}>{t('replay.title')}</h2>
            {replay && (
              <span style={{ fontSize: '0.78rem', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Trophy size={12} color="#fbbf24" aria-hidden="true" /> {replay.winner_name || '—'}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af' }}>{t('replay.loading')}</div>
        ) : !replay || maxStep === 0 ? (
          /* Un vacío con salida: la única acción posible aquí es volver al
             historial, y decirlo evita quedarse mirando una frase gris
             buscando un botón que no existía. */
          <div className="ov-vacio">
            <p>{t('replay.empty')}</p>
            <button type="button" className="btn-premium btn-secondary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        ) : (
          <>
            {/* Tablero reconstruido */}
            <div
              ref={boardRef}
              style={{
                flex: 1, minHeight: '150px', maxHeight: '46vh', overflowX: 'auto', overflowY: 'hidden',
                display: 'flex', alignItems: 'center', gap: '2px',
                padding: '16px 12px', borderRadius: '12px',
                background: 'var(--bg-table, radial-gradient(circle at center, #0f3d30 0%, #041410 100%))',
                border: '1px solid rgba(255,255,255,0.08)'
              }}
            >
              {currentState.chain.length === 0 ? (
                <span style={{ margin: 'auto', color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>{t('replay.start')}</span>
              ) : (
                currentState.chain.map((tile, i) => (
                  <DominoTile
                    key={`${tile[0]}-${tile[1]}-${i}`}
                    tile={tile}
                    horizontal
                    className="replay-tile"
                    style={{ flexShrink: 0, transform: 'scale(0.62)', margin: '-8px -6px' }}
                  />
                ))
              )}
            </div>

            {/* Descripción de la jugada */}
            <div style={{
              textAlign: 'center', fontSize: '0.85rem', color: '#e2e8f0',
              padding: '8px 0', minHeight: '20px'
            }}>
              {moveCaption()}
            </div>

            {/* Barra de progreso */}
            <input
              type="range"
              min={0}
              max={maxStep}
              value={step}
              onChange={e => { setPlaying(false); setStep(Number(e.target.value)); }}
              className="replay-scrubber"
              aria-label={t('replay.move')}
              style={{ width: '100%', accentColor: '#f59e0b', cursor: 'pointer' }}
            />
            <div style={{ textAlign: 'center', fontSize: '0.72rem', color: '#6b7280', marginTop: '2px' }}>
              {t('replay.move')} {step} / {maxStep}
            </div>

            {/* Controles */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '10px' }}>
              {/* Los cinco llevaban sólo `title` o nada: lucide-react no marca
                  sus SVG como decorativos, así que un botón cuyo único hijo es
                  un icono se anuncia sin nombre. */}
              <button type="button" className="btn-premium btn-secondary" style={ctrlStyle}
                title={t('replay.restart')} aria-label={t('replay.restart')}
                onClick={() => { setPlaying(false); setStep(0); }}>
                <Rewind size={16} aria-hidden="true" />
              </button>
              <button type="button" className="btn-premium btn-secondary" style={ctrlStyle}
                title={t('replay.prev')} aria-label={t('replay.prev')}
                onClick={() => { setPlaying(false); setStep(s => Math.max(0, s - 1)); }}>
                <SkipBack size={16} aria-hidden="true" />
              </button>
              {/* Reproducir/pausar es UN interruptor con nombre fijo y estado
                  (`aria-pressed`), no dos nombres distintos: no hay clave de
                  copy para «Pausa» y un botón que se renombra al pulsarlo se
                  anuncia dos veces seguidas. */}
              <button type="button" className="btn-premium btn-primary" style={{ ...ctrlStyle, width: '54px', height: '44px' }}
                aria-label={t('history.watch')} aria-pressed={playing} onClick={togglePlay}>
                {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
              </button>
              <button type="button" className="btn-premium btn-secondary" style={ctrlStyle}
                title={t('replay.next')} aria-label={t('replay.next')}
                onClick={() => { setPlaying(false); setStep(s => Math.min(maxStep, s + 1)); }}>
                <SkipForward size={16} aria-hidden="true" />
              </button>
              <button type="button" className="btn-premium btn-secondary" style={{ ...ctrlStyle, width: '54px', fontSize: '0.8rem', fontWeight: 700 }}
                title={t('replay.speed')} aria-label={t('replay.speed')}
                onClick={() => setSpeed(s => (s === 1 ? 2 : s === 2 ? 4 : 1))}>
                <Gauge size={14} aria-hidden="true" /> {speed}x
              </button>
            </div>

            {/* Marcadores finales */}
            {finalScores.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {finalScores.map((p, i) => (
                  <span key={i} style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'rgba(255,255,255,0.04)', padding: '3px 9px', borderRadius: '10px' }}>
                    {p.name}: <strong style={{ color: '#e2e8f0' }}>{p.score}</strong>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

const ctrlStyle = {
  width: '40px', height: '40px', padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px'
};
