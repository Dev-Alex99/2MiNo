import React, { useRef, useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Move } from 'lucide-react';
import DominoTile from './DominoTile';

// Algoritmo de serpiente simplificado y determinista basado en índice de ficha
function computeSnakeLayout(board) {
  if (!board || board.length === 0) return { layout: [], leftPos: null, rightPos: null };

  const layout = [];
  const TILE_W = 96;
  const TILE_H = 52;
  const GAP = 6;
  const PL_RADIUS = 32;

  for (let i = 0; i < board.length; i++) {
    const tile = board[i];
    const isDouble = tile[0] === tile[1];
    
    // 1. Determinar si es un elemento de curva (bend) cada 4 fichas
    const isBend = (i % 4 === 3);
    const currentDir = isBend ? 'vertical' : 'horizontal';
    const flowDir = (Math.floor(i / 4) % 2 === 0) ? 1 : -1;

    // 2. Determinar dimensiones de la ficha en el espacio 2D
    let w = TILE_W;
    let h = TILE_H;

    if (currentDir === 'horizontal') {
      if (isDouble) {
        w = TILE_H;
        h = TILE_W;
      } else {
        w = TILE_W;
        h = TILE_H;
      }
    } else {
      if (isDouble) {
        w = TILE_W;
        h = TILE_H;
      } else {
        w = TILE_H;
        h = TILE_W;
      }
    }

    // 3. Posicionar de manera secuencial y fluida respecto al anterior
    let x = 0;
    let y = 0;

    if (i > 0) {
      const prev = layout[i - 1];
      const prevIsBend = ((i - 1) % 4 === 3);
      
      if (!prevIsBend && !isBend) {
        // Horizontal a Horizontal (mismo renglón)
        x = prev.x + (prev.w / 2 + GAP + w / 2) * flowDir;
        y = prev.y;
      } else if (!prevIsBend && isBend) {
        // Horizontal a Curva (bajar)
        x = prev.x;
        y = prev.y + prev.h / 2 + GAP + h / 2;
      } else {
        // Curva a Horizontal (nuevo renglón)
        y = prev.y + prev.h / 2 + GAP + h / 2;
        x = prev.x + (prev.w / 2 + GAP + w / 2) * flowDir;
      }
    }

    layout.push({
      tile,
      x,
      y,
      w,
      h,
      isDouble,
      isBend,
      flowDir
    });
  }

  // 4. Calcular posiciones de los placeholders extremos
  const first = layout[0];
  const last = layout[layout.length - 1];

  let leftPos = {
    x: first.x - first.w / 2 - PL_RADIUS - GAP,
    y: first.y
  };

  const lastIsBend = ((layout.length - 1) % 4 === 3);
  const lastFlowDir = (Math.floor((layout.length - 1) / 4) % 2 === 0) ? 1 : -1;

  let rightPos = { x: 0, y: 0 };
  if (lastIsBend) {
    rightPos = {
      x: last.x,
      y: last.y + last.h / 2 + PL_RADIUS + GAP
    };
  } else {
    rightPos = {
      x: last.x + (last.w / 2 + PL_RADIUS + GAP) * lastFlowDir,
      y: last.y
    };
  }

  // 5. Centrar la serpiente entera respecto a (0,0)
  let minX = Math.min(leftPos.x - PL_RADIUS, rightPos.x - PL_RADIUS);
  let maxX = Math.max(leftPos.x + PL_RADIUS, rightPos.x + PL_RADIUS);
  let minY = Math.min(leftPos.y - PL_RADIUS, rightPos.y - PL_RADIUS);
  let maxY = Math.max(leftPos.y + PL_RADIUS, rightPos.y + PL_RADIUS);

  layout.forEach(item => {
    const left = item.x - item.w / 2;
    const right = item.x + item.w / 2;
    const top = item.y - item.h / 2;
    const bottom = item.y + item.h / 2;

    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
    if (top < minY) minY = top;
    if (bottom > maxY) maxY = bottom;
  });

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  layout.forEach(item => {
    item.x -= centerX;
    item.y -= centerY;
  });
  leftPos.x -= centerX;
  leftPos.y -= centerY;
  rightPos.x -= centerX;
  rightPos.y -= centerY;

  return { layout, leftPos, rightPos };
}

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
  activeEffects
}) {
  const boardRef = useRef(null);
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const isMobile = window.innerWidth <= 1024;
    setScale(isMobile ? 0.75 : 0.9);
    setPosition({ x: 0, y: 0 });
  }, [board.length]);

  const resetView = () => {
    const isMobile = window.innerWidth <= 1024;
    setScale(isMobile ? 0.75 : 0.9);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = 0.1;
    let newScale = scale + (e.deltaY < 0 ? zoomFactor : -zoomFactor);
    newScale = Math.max(0.4, Math.min(2, newScale)); 
    setScale(newScale);
  };

  const zoomIn = () => setScale(prev => Math.min(2, prev + 0.15));
  const zoomOut = () => setScale(prev => Math.max(0.4, prev - 0.15));

  const activePlayer = players.find(p => p.id === currentPlayerId);
  const { layout, leftPos, rightPos } = computeSnakeLayout(board);

  return (
    <div 
      ref={containerRef}
      className="game-board-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
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

      {/* Indicador de Turno Flotante */}
      {activePlayer && (
        <div className="turn-banner">
          <span className="turn-pulse-dot" />
          <span className="turn-banner-label">Turno de:</span>
          <span className="turn-banner-name">{activePlayer.name}</span>
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
            
            {/* 1. Renderizar Fichas de Dominó en Serpiente */}
            {layout.map((item, idx) => (
              <div
                key={`${idx}-${item.tile[0]}-${item.tile[1]}`}
                className="shadow-2xl animate-tile-drop"
                style={{
                  position: 'absolute',
                  left: `calc(50% + ${item.x}px)`,
                  top: `calc(50% + ${item.y}px)`,
                  transform: 'translate(-50%, -50%)',
                  width: item.w,
                  height: item.h,
                  transition: 'left 0.4s ease-out, top 0.4s ease-out, transform 0.4s ease-out'
                }}
              >
                <DominoTile
                  tile={item.tile}
                  horizontal={item.w === 96}
                  disabled={false}
                />
              </div>
            ))}

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
