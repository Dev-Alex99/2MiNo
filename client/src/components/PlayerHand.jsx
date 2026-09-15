import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Layers, Download, ArrowLeftRight } from 'lucide-react';
import DominoTile from './DominoTile';
import { useT } from '../i18n/LanguageContext';
import { ladosJugables } from '../games/domino/jugadas';

const CLAVE_ORDEN = 'domino_mano_orden';

// Clave estable de una ficha física, independiente de cómo esté orientada.
// Mismo criterio que GameBoard.jsx:134. Con el índice dentro de la clave, jugar
// la ficha i remontaba todas las de índice mayor y les relanzaba slide-up-fade:
// cada jugada hacía temblar la cola de la mano.
const claveFicha = (tile) => `${Math.min(tile[0], tile[1])}-${Math.max(tile[0], tile[1])}`;

const suma = (tile) => tile[0] + tile[1];
const menor = (tile) => Math.min(tile[0], tile[1]);
const mayor = (tile) => Math.max(tile[0], tile[1]);

function leerOrden() {
  try {
    const v = localStorage.getItem(CLAVE_ORDEN);
    return v === 'palo' ? 'palo' : 'puntos';
  } catch { return 'puntos'; }
}

/**
 * Reordena una COPIA de la mano llevando dentro el índice original: `onPlay` y
 * `selectedTileIndex` hablan siempre en índices de la mano tal y como la manda
 * el servidor, así que el orden de pantalla no puede filtrarse a la jugada.
 */
function ordenar(fichas, orden) {
  const copia = fichas.slice();
  if (orden === 'palo') {
    // El palo de una ficha es su valor menor: así quedan juntas las de cada
    // número, que es como se busca "¿tengo algún 5?".
    copia.sort((f, g) => menor(f.tile) - menor(g.tile) || mayor(f.tile) - mayor(g.tile));
  } else {
    // Por puntos, las más cargadas primero: son las que urge soltar y las que
    // más cuestan si la ronda se cierra.
    copia.sort((f, g) => suma(g.tile) - suma(f.tile) || mayor(g.tile) - mayor(f.tile));
  }
  return copia;
}

/**
 * La mano del jugador: SOLO la fila de fichas y el control de ordenación.
 * La línea de estado, el botón de robar/pasar y el aviso de "elige extremo" se
 * mudaron al riel de extremos, que es donde el pulgar ya está.
 *
 * Toda la fila es UNA parada de tabulación (roving tabindex): dentro se navega
 * con las flechas. Con 7 u 10 fichas, una parada por ficha convertía llegar a
 * los poderes en un viaje.
 */
export default function PlayerHand({
  hand,
  isMyTurn,
  selectedTileIndex,
  setSelectedTileIndex,
  leftEnd,
  rightEnd,
  onPlay,
  onDraw,
  onPass,
  boneyardCount = 0,
  boardIsEmpty,
  onTileClickOverride,
  wildcardActive = false,
  drawEnabled = true
}) {
  const { t } = useT();
  const [orden, setOrden] = useState(leerOrden);
  const [indiceFoco, setIndiceFoco] = useState(0);
  const refsFicha = useRef([]);
  const focoDentro = useRef(false);

  const mano = Array.isArray(hand) ? hand : [];
  const ctx = { isMyTurn, wildcardActive, boardIsEmpty, leftEnd, rightEnd };
  const hasMoves = mano.some(tile => {
    const { left, right } = ladosJugables(tile, ctx);
    return left || right;
  });
  const fichas = ordenar(mano.map((tile, indice) => ({ tile, indice })), orden);
  const total = fichas.length;
  // El foco se queda dentro del rango aunque la mano encoja al jugar.
  const foco = total > 0 ? Math.min(indiceFoco, total - 1) : 0;
  refsFicha.current.length = total;

  const moverFoco = useCallback((destino) => {
    const n = refsFicha.current.length;
    if (n === 0) return;
    const i = Math.max(0, Math.min(destino, n - 1));
    setIndiceFoco(i);
    const el = refsFicha.current[i];
    if (el) {
      el.focus();
      // La fila es overflow-x:auto: sin esto el foco se iría a una ficha que
      // está fuera de la vista y no se vería el anillo.
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  // Al jugar una ficha con el teclado su botón desaparece y el foco se cae al
  // <body>. Sin esto habría que volver a tabular hasta la mano en cada jugada.
  // Mientras el foco siga dentro de una ficha este efecto no hace nada, así que
  // no compite con la navegación por flechas.
  useEffect(() => {
    if (!focoDentro.current || total === 0) return;
    const activo = document.activeElement;
    if (activo && activo !== document.body) return;
    refsFicha.current[Math.min(indiceFoco, total - 1)]?.focus();
  }, [total, indiceFoco]);

  const activarFicha = (ficha) => {
    if (!isMyTurn) return;

    if (onTileClickOverride) {
      onTileClickOverride(ficha.indice, ficha.tile);
      return;
    }

    const { left, right } = ladosJugables(ficha.tile, ctx);
    // El rechazo de la ficha no jugable vive aquí y no en el atributo
    // `disabled`, que la sacaría del orden de tabulación.
    if (!left && !right) return;

    // Jugada inteligente instantánea si solo encaja en un lado único
    if (left && !right) {
      onPlay(ficha.indice, 'left');
      setSelectedTileIndex(null);
      return;
    }
    if (right && !left) {
      onPlay(ficha.indice, 'right');
      setSelectedTileIndex(null);
      return;
    }
    if (boardIsEmpty) {
      onPlay(ficha.indice, 'left');
      setSelectedTileIndex(null);
      return;
    }

    // Si la ficha pega por ambos lados, se selecciona para elegir extremo
    setSelectedTileIndex(selectedTileIndex === ficha.indice ? null : ficha.indice);
  };

  const jugarElegidaPor = (lado) => {
    const elegida = mano[selectedTileIndex];
    if (!elegida) return;
    if (!ladosJugables(elegida, ctx)[lado]) return;
    onPlay(selectedTileIndex, lado);
    setSelectedTileIndex(null);
  };

  const alPulsarTecla = (e, ficha, i) => {
    // Con ficha elegida las flechas dejan de mover el foco y juegan a ese
    // extremo: con teclado la interacción de dos pasos sale más rápida que con
    // el dedo. Escape devuelve las flechas a la navegación.
    const eligiendoExtremo = isMyTurn && !onTileClickOverride && selectedTileIndex !== null;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const lado = e.key === 'ArrowLeft' ? 'left' : 'right';
        if (eligiendoExtremo) jugarElegidaPor(lado);
        else moverFoco(e.key === 'ArrowLeft' ? i - 1 : i + 1);
        break;
      }
      case 'Home':
        e.preventDefault();
        moverFoco(0);
        break;
      case 'End':
        e.preventDefault();
        moverFoco(total - 1);
        break;
      case 'Enter':
      case ' ':
        // preventDefault ANTES de actuar: si no, el botón dispararía además su
        // clic nativo y la ficha se jugaría dos veces.
        e.preventDefault();
        activarFicha(ficha);
        break;
      case 'Escape':
        if (selectedTileIndex !== null) {
          e.preventDefault();
          setSelectedTileIndex(null);
        }
        break;
      default:
        break;
    }
  };

  const etiquetaFicha = (tile, lados) => {
    const [a, b] = tile;
    const base = a === b ? t('a11y.fichaDoble', { a }) : t('a11y.ficha', { a, b });
    // El sufijo de encaje solo en mi turno: repetir "no encaja" siete veces
    // mientras esperas es ruido, no información.
    if (!isMyTurn) return base;
    let encaje;
    if (lados.left && lados.right) encaje = t('a11y.encajaAmbos');
    else if (lados.left) encaje = t('a11y.encajaIzq');
    else if (lados.right) encaje = t('a11y.encajaDer');
    else encaje = t('a11y.noEncaja');
    return `${base}, ${encaje}`;
  };

  const alternarOrden = () => {
    const siguiente = orden === 'puntos' ? 'palo' : 'puntos';
    setOrden(siguiente);
    try { localStorage.setItem(CLAVE_ORDEN, siguiente); } catch { /* modo privado */ }
  };

  const alHacerDobleClic = (ficha) => {
    if (!isMyTurn || onTileClickOverride) return;
    const { left, right } = ladosJugables(ficha.tile, ctx);
    if (left || right) {
      onPlay(ficha.indice, left ? 'left' : 'right');
      setSelectedTileIndex(null);
    }
  };

  // El nombre del botón es la acción que hace, no el estado en que está: es lo
  // único que se puede decir sin ambigüedad con un solo control de dos estados.
  const etiquetaOrden = orden === 'puntos' ? t('mano.ordenPalo') : t('mano.ordenPuntos');

  return (
    <div className="player-hand-container">
      {/* Indicador de Estado / Acciones Rápidas */}
      <div className="hand-status-row">
        {isMyTurn ? (
          !hasMoves ? (
            drawEnabled && boneyardCount > 0 ? (
              <button
                type="button"
                onClick={onDraw}
                className="btn-premium btn-accent"
                style={{ padding: '8px 20px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Download size={16} aria-hidden="true" />
                {t('hand.drawFromBoneyard', { n: boneyardCount })}
              </button>
            ) : (
              <button
                type="button"
                onClick={onPass}
                className="btn-premium btn-secondary"
                style={{ padding: '8px 20px', fontSize: '0.8rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <ArrowLeftRight size={16} aria-hidden="true" />
                {drawEnabled ? t('hand.passNoDraw') : t('hand.passNoPlay')}
              </button>
            )
          ) : selectedTileIndex !== null ? (
            <div className="select-hint-box">
              <span>{t('hand.selectEnd')}</span>
              <button
                type="button"
                onClick={() => setSelectedTileIndex(null)}
                className="select-hint-cancel"
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <div className="turn-notification">
              <span className="turn-notification-ping"></span>
              {t('hand.yourTurnSelect')}
            </div>
          )
        ) : (
          <div className="waiting-turn-msg">
            {t('hand.waiting')}
          </div>
        )}
      </div>

      <div
        className="hand-tiles-row"
        role="group"
        aria-label={t('uno.yourHand')}
        onFocus={() => { focoDentro.current = true; }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) focoDentro.current = false;
        }}
      >
        {fichas.map((ficha, i) => {
          const lados = ladosJugables(ficha.tile, ctx);
          const esJugable = lados.left || lados.right;
          const esElegida = selectedTileIndex === ficha.indice;
          // Fuera de mi turno, y mientras un poder pide elegir ficha, todas las
          // fichas son neutras: no hay jugada legal que señalar.
          const senala = isMyTurn && !onTileClickOverride;
          let estado = '';
          if (esElegida) estado = 'esta-elegida';
          else if (senala) estado = esJugable ? 'es-jugable' : 'no-jugable';

          return (
            <div
              key={claveFicha(ficha.tile)}
              className="hand-tile-wrapper"
              style={{ position: 'relative', zIndex: esElegida ? 15 : undefined }}
            >
              <DominoTile
                tile={ficha.tile}
                className={`hand-tile mano-ficha ${estado}`}
                interactivo
                innerRef={(el) => { refsFicha.current[i] = el; }}
                tabIndex={i === foco ? 0 : -1}
                ariaLabel={etiquetaFicha(ficha.tile, lados)}
                ariaDisabled={senala && !esJugable}
                ariaPosinset={i + 1}
                ariaSetsize={total}
                onClick={() => activarFicha(ficha)}
                onDoubleClick={() => alHacerDobleClic(ficha)}
                onKeyDown={(e) => alPulsarTecla(e, ficha, i)}
              />
            </div>
          );
        })}
      </div>

      {/* Va DESPUÉS de las fichas en el DOM para que la tabulación llegue
          primero a lo que se usa cada turno. */}
      {total > 1 && (
        <button
          type="button"
          className="mano-orden"
          onClick={alternarOrden}
          aria-label={etiquetaOrden}
          title={etiquetaOrden}
        >
          {orden === 'puntos'
            ? <ArrowDownWideNarrow size={14} aria-hidden="true" />
            : <Layers size={14} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
