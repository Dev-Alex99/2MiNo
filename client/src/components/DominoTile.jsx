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
    // --- Valores del dominó doble 9 ---
    case 7:
      // El 6 más el punto central.
      return isHorizontal
        ? [0, 1, 2, 4, 6, 7, 8]
        : [0, 2, 3, 4, 5, 6, 8];
    case 8:
      // Rejilla completa menos el centro (igual en ambas orientaciones).
      return [0, 1, 2, 3, 5, 6, 7, 8];
    case 9:
      // Rejilla 3x3 completa.
      return [0, 1, 2, 3, 4, 5, 6, 7, 8];
    default: return [];
  }
};

// La ayuda de matiz para distinguir 7/8/9 se conserva, pero pasa por el gancho
// --pip-color de fichas.css: antes era un `background` fijo inyectado aquí, que
// PISABA --tile-pip y dejaba el 6 a 2,33:1 sobre la ficha blanca además de
// romper el contrato de la tienda (comprar una skin no cambiaba los pips 6-9).
// Los tokens --pip-6..9 se derivan de la tinta de la skin en base.css.
const TOKEN_PIP = {
  6: 'var(--pip-6)',
  7: 'var(--pip-7)',
  8: 'var(--pip-8)',
  9: 'var(--pip-9)'
};

function DominoTile({
  tile,
  onClick,
  onDoubleClick,
  selected,
  playable,
  disabled,
  horizontal = false,
  className = '',
  style,
  // Solo la mano activa `interactivo`: sus fichas son la acción principal de la
  // partida y tienen que ser botones de verdad. Las del tablero siguen siendo
  // <div aria-hidden>: en doble 9 serían 51 paradas de tabulación.
  interactivo = false,
  ariaLabel,
  ariaDisabled,
  ariaPosinset,
  ariaSetsize,
  tabIndex,
  onKeyDown,
  innerRef
}) {
  const [val1, val2] = tile;

  // Renderiza los 9 espacios de la rejilla, marcando con un punto (pip) los válidos
  const renderHalf = (val) => {
    const activePips = getPipsForValue(val, horizontal);
    return (
      <div
        className="pip-grid"
        style={TOKEN_PIP[val] ? { '--pip-color': TOKEN_PIP[val] } : undefined}
      >
        {Array.from({ length: 9 }).map((_, idx) => {
          const isActive = activePips.includes(idx);
          return <div key={idx} className={`pip ${isActive ? 'active' : ''}`} />;
        })}
      </div>
    );
  };

  const clases = `domino-tile ${horizontal ? 'horizontal' : ''} ${selected ? 'selected' : ''} ${playable ? 'playable' : ''} ${disabled ? 'disabled' : ''} ${className}`;

  const contenido = (
    <>
      {/* Mitad superior / izquierda */}
      {renderHalf(val1)}

      {/* Línea divisoria central con perno metálico */}
      <div className="divider" />

      {/* Mitad inferior / derecha */}
      {renderHalf(val2)}
    </>
  );

  if (interactivo) {
    return (
      // NUNCA el atributo `disabled`: sacaría la ficha del orden de tabulación y
      // un usuario de lector no podría repasar su propia mano. El rechazo lo
      // hace el manejador.
      <button
        type="button"
        ref={innerRef}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        style={style}
        className={clases}
        aria-label={ariaLabel}
        aria-disabled={ariaDisabled ? true : undefined}
        aria-posinset={ariaPosinset}
        aria-setsize={ariaSetsize}
        tabIndex={tabIndex}
      >
        {contenido}
      </button>
    );
  }

  return (
    <div
      ref={innerRef}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={style}
      className={clases}
    >
      {contenido}
    </div>
  );
}

// Memoizado: las fichas del tablero solo se re-renderizan si cambian sus props.
// Evita recalcular las rejillas de puntos de decenas de fichas en cada tick de estado.
export default React.memo(DominoTile);
