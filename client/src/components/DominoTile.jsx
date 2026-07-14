import React from 'react';

// Posiciones en una rejilla 3x3 (0 a 8) para representar los puntos (pips)
// 0: top-left,  1: top-center,  2: top-right
// 3: mid-left,  4: mid-center,  5: mid-right
// 6: bot-left,  7: bot-center,  8: bot-right
const getPipsForValue = (val, isHorizontal) => {
  switch (val) {
    case 0: return [];
    case 1: return [4];
    case 2: return [0, 8];
    case 3: return [0, 4, 8];
    case 4: return [0, 2, 6, 8];
    case 5: return [0, 2, 4, 6, 8];
    case 6:
      // Si la ficha está acostada (horizontal), los 6 puntos van en las filas superior e inferior.
      // Si está parada (vertical), van en las columnas izquierda y derecha.
      return isHorizontal 
        ? [0, 1, 2, 6, 7, 8] 
        : [0, 2, 3, 5, 6, 8];
    default: return [];
  }
};

export default function DominoTile({ 
  tile, 
  onClick, 
  selected, 
  playable, 
  disabled, 
  horizontal = false, 
  className = '' 
}) {
  const [val1, val2] = tile;

  // Renderiza los 9 espacios de la rejilla, marcando con un punto (pip) los válidos
  const renderHalf = (val) => {
    const activePips = getPipsForValue(val, horizontal);
    return (
      <div className="pip-grid">
        {Array.from({ length: 9 }).map((_, idx) => {
          const isActive = activePips.includes(idx);
          return (
            <div 
              key={idx} 
              className={`pip ${isActive ? 'active' : ''}`}
              style={{
                background: val === 6 ? '#10b981' : undefined // Puntos del 6 en esmeralda para estilo premium
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div
      onClick={onClick}
      className={`domino-tile ${horizontal ? 'horizontal' : ''} ${selected ? 'selected' : ''} ${playable ? 'playable' : ''} ${disabled ? 'disabled' : ''} ${className}`}
    >
      {/* Mitad superior / izquierda */}
      {renderHalf(val1)}

      {/* Línea divisoria central con perno metálico */}
      <div className="divider" />

      {/* Mitad inferior / derecha */}
      {renderHalf(val2)}
    </div>
  );
}
