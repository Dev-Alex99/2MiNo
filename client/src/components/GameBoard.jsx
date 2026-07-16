import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Move } from 'lucide-react';
import DominoTile from './DominoTile';

// Dimensiones reales de una ficha en el tablero (coinciden con el CSS fijado en .board-tile-wrap).
const TILE_LONG = 96;   // largo de la ficha (dimensión mayor)
const TILE_SHORT = 52;  // ancho de la ficha (dimensión menor)
const GAP = 8;          // separación entre fichas contiguas de una fila
const PL = 32;          // radio de los círculos de extremo (placeholders)
const HALF_L = TILE_LONG / 2;
const HALF_S = TILE_SHORT / 2;

/**
 * Calcula un layout de serpiente (boustrophedon) determinista y ordenado.
 *
 * El tablero llega como una cadena ya orientada: board[i] = [a, b] donde
 * b === board[i+1][0]. Es decir, el valor derecho de cada ficha coincide con
 * el izquierdo de la siguiente. Aprovechamos eso para que los puntos siempre
 * "conecten" visualmente, volteando los valores en las filas que van de
 * derecha a izquierda.
 *
 * - Fichas normales: acostadas (horizontal).
 * - Dobles: parados (vertical), como en un dominó real.
 * - Al llenar una fila, la siguiente ficha se coloca PARADA (vertical) haciendo
 *   la esquina en "L": su borde superior conecta con la fila de arriba y el
 *   inferior con la fila siguiente, que continúa en sentido inverso.
 */
function computeSnakeLayout(board, maxWidth) {
  if (!board || board.length === 0) {
    return { layout: [], leftPos: null, rightPos: null, width: 0, height: 0 };
  }

  const budget = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 1000;
  // Cuántas fichas horizontales caben por fila dejando margen para los extremos.
  const perRow = Math.max(4, Math.floor((budget - TILE_LONG) / (TILE_LONG + GAP)));

  const items = [];
  let dir = 1;        // 1 => la fila avanza a la derecha, -1 => a la izquierda
  let colCount = 0;   // fichas acostadas/dobles ya colocadas en la fila actual
  let rowCy = 0;      // centro vertical de la fila actual
  let prev = null;

  for (let i = 0; i < board.length; i++) {
    const [a, b] = board[i];
    const isDouble = a === b;

    let cx;
    let cy;
    let w;
    let h;
    let horizontal;
    let display;
    let isCorner = false;

    if (prev === null) {
      // Primera ficha: acostada, centrada; la fila arranca hacia la derecha.
      w = TILE_LONG; h = TILE_SHORT; horizontal = true;
      display = [a, b];
      cx = 0; cy = 0; rowCy = 0; colCount = 1;
    } else if (colCount >= perRow) {
      // GIRO: ficha PARADA (vertical) que baja a la fila siguiente formando una "L".
      // top = a conecta con la fila de arriba, bottom = b con la de abajo.
      // cy despeja el borde inferior REAL de la ficha previa (26 acostada, 48 doble).
      w = TILE_SHORT; h = TILE_LONG; horizontal = false;
      display = [a, b];
      isCorner = true;
      cx = prev.cx + dir * (prev.w / 2 - HALF_S);
      cy = rowCy + prev.h / 2 + HALF_L;
      dir = -dir;
      rowCy = cy + (HALF_L - HALF_S);
      colCount = 0;
    } else if (isDouble) {
      // Doble parado en línea (no gira).
      w = TILE_SHORT; h = TILE_LONG; horizontal = false;
      display = [a, b];
      cx = prev.cx + dir * (prev.w / 2 + GAP + HALF_S);
      cy = rowCy;
      colCount += 1;
    } else {
      // Ficha acostada normal (también la primera de una fila tras una esquina).
      // En filas hacia la izquierda se voltean los valores para que el punto de
      // conexión quede del lado correcto.
      w = TILE_LONG; h = TILE_SHORT; horizontal = true;
      display = dir === 1 ? [a, b] : [b, a];
      cx = prev.cx + dir * (prev.w / 2 + GAP + HALF_L);
      cy = rowCy;
      colCount += 1;
    }

    const item = { tile: board[i], display, cx, cy, w, h, horizontal, dir, isCorner };
    items.push(item);
    prev = item;
  }

  // Extremo izquierdo: siempre el lado "a" de la primera ficha (a su izquierda).
  const first = items[0];
  const leftPos = {
    x: first.cx - first.w / 2 - GAP - PL,
    y: first.cy
  };

  // Extremo derecho: el borde de crecimiento tras la última ficha, en su sentido.
  // Si la última ficha es una esquina, el crecimiento sale por debajo de ella.
  const last = items[items.length - 1];
  const rightPos = last.isCorner
    ? { x: last.cx + last.dir * (last.w / 2 + GAP + PL), y: last.cy + (HALF_L - HALF_S) }
    : { x: last.cx + last.dir * (last.w / 2 + GAP + PL), y: last.cy };

  // Límites del contenido para poder centrar y auto-encajar.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const account = (x, y, halfW, halfH) => {
    if (x - halfW < minX) minX = x - halfW;
    if (x + halfW > maxX) maxX = x + halfW;
    if (y - halfH < minY) minY = y - halfH;
    if (y + halfH > maxY) maxY = y + halfH;
  };
  items.forEach((it) => account(it.cx, it.cy, it.w / 2, it.h / 2));
  account(leftPos.x, leftPos.y, PL, PL);
  account(rightPos.x, rightPos.y, PL, PL);

  // Centrar todo respecto a (0,0).
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  items.forEach((it) => {
    it.cx -= centerX;
    it.cy -= centerY;
  });
  leftPos.x -= centerX;
  leftPos.y -= centerY;
  rightPos.x -= centerX;
  rightPos.y -= centerY;

  return {
    layout: items,
    leftPos,
    rightPos,
    width: maxX - minX,
    height: maxY - minY
  };
}

// Clave estable de una ficha física, independiente de cómo esté orientada.
const tileKey = (tile) => `${Math.min(tile[0], tile[1])}-${Math.max(tile[0], tile[1])}`;

export default function GameBoard({
  board,
  selectedTileIndex,
  onPlay,
  isMyTurn,
  players,
  currentPlayerId,
  canPlayLeft,
  canPlayRight,
  pendingTargetType,
  onSelectEndTarget,
  activeEffects,
  lastPlay,
  turnEndsAt,
  turnSecondsRemaining,
  turnDurationSeconds = 30
}) {
  const containerRef = useRef(null);
  const boardRef = useRef(null);
  const dragRef = useRef({ active: false, sx: 0, sy: 0 });

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  // Mientras el usuario no interactúe, el tablero se auto-encaja al contenido.
  const [manualView, setManualView] = useState(false);

  // Firma estable del tablero: evita recalcular el layout en ticks de estado
  // que no cambian las fichas (p. ej. cuentas regresivas de poderes).
  const boardSignature = useMemo(
    () => board.map((t) => `${t[0]}${t[1]}`).join('|'),
    [board]
  );

  const { layout, leftPos, rightPos, width, height } = useMemo(
    () => computeSnakeLayout(board, containerSize.w || 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardSignature, containerSize.w]
  );

  // Escala ideal para que toda la serpiente entre en el contenedor.
  const fitScale = useMemo(() => {
    if (!width || !height || !containerSize.w || !containerSize.h) return 1;
    const padding = 96;
    const sx = (containerSize.w - padding) / width;
    const sy = (containerSize.h - padding) / height;
    return Math.max(0.35, Math.min(1.05, Math.min(sx, sy)));
  }, [width, height, containerSize.w, containerSize.h]);

  // Observar el tamaño del contenedor para el auto-encaje responsivo.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Aplicar auto-encaje salvo que el usuario haya tomado control manual.
  useEffect(() => {
    if (!manualView) {
      setScale(fitScale);
      setPosition({ x: 0, y: 0 });
    }
  }, [fitScale, manualView]);

  const resetView = useCallback(() => setManualView(false), []);
  const zoomIn = useCallback(() => {
    setManualView(true);
    setScale((s) => Math.min(2.2, s + 0.15));
  }, []);
  const zoomOut = useCallback(() => {
    setManualView(true);
    setScale((s) => Math.max(0.35, s - 0.15));
  }, []);

  // Rueda del ratón: listener nativo no pasivo para poder usar preventDefault
  // sin warnings y sin bloquear el scroll de la página.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      setManualView(true);
      setScale((s) => {
        const next = s + (e.deltaY < 0 ? 0.12 : -0.12);
        return Math.max(0.35, Math.min(2.2, next));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Paneo con Pointer Events (soporta ratón y táctil).
  const handlePointerDown = useCallback(
    (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      // No iniciar paneo si se pulsa un control (botones de zoom o de extremo):
      // así su click funciona sin ser robado por la captura del puntero.
      if (e.target.closest && e.target.closest('button')) return;
      dragRef.current = { active: true, sx: e.clientX - position.x, sy: e.clientY - position.y };
      setIsDragging(true);
      if (e.currentTarget.setPointerCapture) {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      }
    },
    [position.x, position.y]
  );

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current.active) return;
    setManualView(true);
    setPosition({ x: e.clientX - dragRef.current.sx, y: e.clientY - dragRef.current.sy });
  }, []);

  const handlePointerUp = useCallback((e) => {
    dragRef.current.active = false;
    setIsDragging(false);
    if (e.currentTarget.releasePointerCapture && e.pointerId != null) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    }
  }, []);

  const activePlayer = players.find((p) => p.id === currentPlayerId);

  // Cuenta atrás del turno. El servidor manda los segundos ya calculados y
  // turnEndsAt cambia en cada rearme, así que basta con resincronizar ahí y
  // descontar en local: sin depender de que los relojes coincidan.
  const [secondsLeft, setSecondsLeft] = useState(turnSecondsRemaining);

  useEffect(() => {
    setSecondsLeft(turnSecondsRemaining);
  }, [turnSecondsRemaining, turnEndsAt, currentPlayerId]);

  useEffect(() => {
    if (turnSecondsRemaining == null) return undefined;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [turnSecondsRemaining, turnEndsAt, currentPlayerId]);

  const showTimer = secondsLeft != null;
  const timerUrgent = showTimer && secondsLeft <= 10;
  const timerPct = showTimer
    ? Math.max(0, Math.min(100, (secondsLeft / turnDurationSeconds) * 100))
    : 0;

  // Resaltar la última ficha colocada: ayuda a seguir el hilo, sobre todo en
  // doble 9 donde el tablero puede llegar a 55 fichas.
  const lastKey = lastPlay && lastPlay.tile ? tileKey(lastPlay.tile) : null;
  const lastPlayerName = lastPlay
    ? players.find((p) => p.id === lastPlay.playerId)?.name
    : null;

  return (
    <div
      ref={containerRef}
      className="game-board-container"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(16,185,129,0.12),rgba(0,0,0,0))] pointer-events-none" />

      {/* Controles de Vista flotantes */}
      <div className="zoom-controls">
        <button onClick={zoomIn} className="zoom-btn" title="Acercar">
          <ZoomIn size={18} />
        </button>
        <button onClick={zoomOut} className="zoom-btn" title="Alejar">
          <ZoomOut size={18} />
        </button>
        <button onClick={resetView} className="zoom-btn" title="Centrar Tablero">
          <Maximize2 size={16} />
          <span className="zoom-btn-text">Centrar</span>
        </button>
      </div>

      {/* Indicador de Turno Flotante + reloj */}
      {activePlayer && (
        <div className={`turn-banner ${timerUrgent ? 'urgent' : ''}`}>
          <div className="turn-banner-row">
            <span className="turn-pulse-dot" />
            <span className="turn-banner-label">Turno de:</span>
            <span className="turn-banner-name">{activePlayer.name}</span>
            {showTimer && (
              <span className="turn-timer-value">{secondsLeft}s</span>
            )}
          </div>
          {showTimer && (
            <div className="turn-timer-track">
              <div className="turn-timer-fill" style={{ width: `${timerPct}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Contenedor del Tablero (Afectado por Paneo y Zoom) */}
      <div
        ref={boardRef}
        className="board-canvas"
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)'
        }}
      >
        {board.length === 0 ? (
          isMyTurn && selectedTileIndex !== null ? (
            <button
              onClick={() => onPlay(selectedTileIndex, 'left')}
              className="board-placeholder-circle animate-pulse-glow"
            >
              ＋
            </button>
          ) : (
            <div className="empty-board-msg">
              <Move size={36} className="animate-bounce" />
              <span className="empty-board-msg-title">Tablero Vacío</span>
              <span className="empty-board-msg-text">El primer jugador puede colocar cualquier ficha en el centro</span>
            </div>
          )
        ) : (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>

            {/* 1. Fichas de Dominó en Serpiente */}
            {layout.map((item) => {
              // Clave estable por ficha física (independiente de la orientación):
              // evita re-montar y re-animar todas las fichas al jugar a la izquierda.
              const key = tileKey(item.tile);
              const isLast = lastKey !== null && key === lastKey;
              return (
                <div
                  key={key}
                  className={`board-tile-wrap ${isLast ? 'last-played' : ''}`}
                  title={isLast && lastPlayerName ? `Última ficha · ${lastPlayerName}` : undefined}
                  style={{
                    position: 'absolute',
                    left: `calc(50% + ${item.cx}px)`,
                    top: `calc(50% + ${item.cy}px)`,
                    width: item.w,
                    height: item.h,
                    transform: 'translate(-50%, -50%)',
                    transition: 'left 0.4s ease-out, top 0.4s ease-out'
                  }}
                >
                  {/* Envoltorio interno: la animación de caída actúa aquí, sin
                      pisar el translate(-50%,-50%) de centrado del contenedor. */}
                  <div className="board-tile-anim animate-tile-drop">
                    <DominoTile
                      tile={item.display}
                      horizontal={item.horizontal}
                      disabled={false}
                    />
                  </div>
                </div>
              );
            })}

            {/* 2. Controles del Extremo Izquierdo */}
            {leftPos && (
              <div
                style={{
                  position: 'absolute',
                  left: `calc(50% + ${leftPos.x}px)`,
                  top: `calc(50% + ${leftPos.y}px)`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 20,
                  transition: 'left 0.4s ease-out, top 0.4s ease-out'
                }}
              >
                {isMyTurn && canPlayLeft && pendingTargetType !== 'end_target' && (
                  <button
                    onClick={() => onPlay(selectedTileIndex, 'left')}
                    className="board-placeholder-circle animate-pulse-glow"
                  >
                    ←
                  </button>
                )}

                {activeEffects?.frozenEnd === 'left' && (
                  <div className="board-placeholder-circle frozen" title="Extremo Congelado" />
                )}

                {isMyTurn && pendingTargetType === 'end_target' && (
                  <button
                    onClick={() => onSelectEndTarget('left')}
                    className="board-placeholder-circle"
                    style={{ borderStyle: 'dashed', borderColor: '#818cf8', color: '#a5b4fc' }}
                    title="Congelar Extremo Izquierdo"
                  >
                    ❄️
                  </button>
                )}
              </div>
            )}

            {/* 3. Controles del Extremo Derecho */}
            {rightPos && (
              <div
                style={{
                  position: 'absolute',
                  left: `calc(50% + ${rightPos.x}px)`,
                  top: `calc(50% + ${rightPos.y}px)`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 20,
                  transition: 'left 0.4s ease-out, top 0.4s ease-out'
                }}
              >
                {isMyTurn && canPlayRight && pendingTargetType !== 'end_target' && (
                  <button
                    onClick={() => onPlay(selectedTileIndex, 'right')}
                    className="board-placeholder-circle animate-pulse-glow"
                  >
                    →
                  </button>
                )}

                {activeEffects?.frozenEnd === 'right' && (
                  <div className="board-placeholder-circle frozen" title="Extremo Congelado" />
                )}

                {isMyTurn && pendingTargetType === 'end_target' && (
                  <button
                    onClick={() => onSelectEndTarget('right')}
                    className="board-placeholder-circle"
                    style={{ borderStyle: 'dashed', borderColor: '#818cf8', color: '#a5b4fc' }}
                    title="Congelar Extremo Derecho"
                  >
                    ❄️
                  </button>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
