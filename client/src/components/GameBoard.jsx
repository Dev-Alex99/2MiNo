import React, { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { Maximize2, ScrollText, Trophy } from 'lucide-react';
import DominoTile from './DominoTile';
import MoveLog from './MoveLog';
import { useT } from '../i18n/LanguageContext';
import {
  trazarSerpiente,
  elegirPerRow,
  escalaDeVista,
  cajaDeLaJugada,
  fichasDelMazo,
  maxPipDelMazo,
} from '../games/domino/trazado';
import { leerGeometria } from '../games/domino/mesaConfig';
import { colorDeJugador } from '../utils/colorDeJugador';

// Cámara "seguir la jugada".
const UMBRAL_MANUAL = 8;    // px de scroll a mano que apagan el seguimiento
const ESPERA_MANUAL = 6000; // ms que se queda apagado antes de volver solo
const AIRE_CAMARA = 24;     // aire alrededor de la jugada al encuadrarla
const VUELO_CAMARA = 1000;  // techo de seguridad del scroll suave, en ms

// Vida de la animación de entrada de una ficha (caída 450 ms + onda 650 ms).
// Se desmonta con temporizador y no con onAnimationEnd porque el evento no
// llega cuando el usuario tiene el movimiento reducido, y entonces .shockwave
// se quedaba viva el resto de la ronda: un nodo con z-index 30 e inset -25px
// tapando fichas vecinas.
const VIDA_ENTRADA = 700;

// Clave estable de una ficha física, independiente de cómo esté orientada.
const claveFicha = (tile) => `${Math.min(tile[0], tile[1])}-${Math.max(tile[0], tile[1])}`;

// La geometría llega de getComputedStyle, así que cada lectura crea un objeto
// nuevo. Sin esta comparación, guardarla en estado dispararía un re-render por
// cada medida y con él otra lectura.
function mismaGeometria(a, b) {
  return a.largo === b.largo && a.corto === b.corto && a.hueco === b.hueco
    && a.margen === b.margen && a.escMin === b.escMin && a.escMax === b.escMax
    && a.padX === b.padX && a.padY === b.padY;
}

/**
 * La mesa: traza la serpiente, la escala y la deja leer con scroll vertical.
 *
 * Ya no hace paneo ni zoom. El contenedor es un scroll nativo, así que vuelven
 * gratis la inercia, el teclado y el pinch-zoom del navegador —que `touch-action:
 * none` mataba justo encima del tablero, o sea justo donde alguien intentaría
 * ampliar unas fichas de 34x18 px—. Con el paneo se va también `manualView`, que
 * se encendía con 1 px de temblor y dejaba el auto-encaje muerto el resto de la
 * ronda sin que nadie supiera por qué.
 *
 * No conoce asientos ni mano: el objetivo de jugar vive en el riel, en espacio
 * de pantalla, y no dentro de este lienzo escalado.
 */
export default function GameBoard({
  board = [],
  players = [],
  lastPlay,
  lastPlacedTile,
  lastPlacedBy,
  moveLog = [],
  onOpenBracket,
  totalMazo,
  maxPip,
  selectedTileIndex = null,
  onPlay,
  isMyTurn = false,
  canPlayLeft = false,
  canPlayRight = false,
  pendingTargetType = null,
  onSelectEndTarget,
  activeEffects = null,
  selectedPower = null,
}) {
  const { t } = useT();
  const refContenedor = useRef(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const [geom, setGeom] = useState(() => leerGeometria(null));
  const [showMoveLog, setShowMoveLog] = useState(false);
  const [camaraManual, setCamaraManual] = useState(false);
  const [reencuadre, setReencuadre] = useState(0);
  const [fichaNueva, setFichaNueva] = useState(null);
  const camara = useRef({ ancla: 0, vuelo: 0, espera: 0 });

  // El tamaño del mazo no se deduce sumando manos y pozo: `tile_demolition`
  // destruye fichas y esa suma miente. Sale de maxPip, que el servidor difunde.
  const pips = Number.isFinite(maxPip) ? maxPip : maxPipDelMazo(totalMazo || 28);
  const mazo = Number.isFinite(totalMazo) ? totalMazo : fichasDelMazo(pips);

  // Medir con useLayoutEffect: en un useEffect el navegador llega a pintar un
  // fotograma con el tablero sin medir, y se veía la mesa grande encogiéndose
  // cada vez que se volvía del modal de fin de ronda.
  useLayoutEffect(() => {
    const el = refContenedor.current;
    if (!el) return undefined;
    const medir = () => {
      setTam((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight
        ? prev
        : { w: el.clientWidth, h: el.clientHeight }));
      const leida = leerGeometria(el);
      setGeom((prev) => (mismaGeometria(prev, leida) ? prev : leida));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const medido = tam.w > 0;
  const uW = Math.max(0, tam.w - 2 * geom.padX);
  const uH = Math.max(0, tam.h - 2 * geom.padY);

  // Firma estable del tablero: evita recalcular el trazado en ticks de estado
  // que no cambian las fichas (p. ej. cuentas regresivas de poderes).
  const boardSignature = useMemo(
    () => board.map((f) => `${f[0]}${f[1]}`).join('|'),
    [board]
  );

  // perRow se fija por ronda: no depende del tablero, sólo del mazo y del hueco
  // disponible. Por eso la mesa nunca se rebaraja a media partida.
  const perRow = useMemo(
    () => elegirPerRow(mazo, pips, uW, uH, geom.escMin, geom.escMax, geom),
    [mazo, pips, uW, uH, geom]
  );

  const trazo = useMemo(
    () => trazarSerpiente(board, {
      perRow,
      margen: geom.margen,
      largo: geom.largo,
      corto: geom.corto,
      hueco: geom.hueco,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardSignature, perRow, geom]
  );

  const escala = useMemo(
    () => escalaDeVista(trazo, uW, uH, geom.escMin, geom.escMax),
    [trazo, uW, uH, geom]
  );

  // Última ficha colocada. Si el último acto fue un pase (lastPlay.tile null,
  // p. ej. una tranca), caemos a la última ficha REALMENTE colocada para que se
  // siga viendo la jugada final.
  const fichaDestacada = (lastPlay && lastPlay.tile) || lastPlacedTile || null;
  const jugadaPor = (lastPlay && lastPlay.tile) ? lastPlay.playerId : lastPlacedBy;
  const claveUltima = fichaDestacada ? claveFicha(fichaDestacada) : null;
  const nombreUltimo = jugadaPor ? players.find((p) => p.id === jugadaPor)?.name : null;

  // La animación de entrada vive un rato y se desmonta: ver VIDA_ENTRADA.
  useEffect(() => {
    if (!claveUltima) return undefined;
    setFichaNueva(claveUltima);
    const id = window.setTimeout(() => setFichaNueva(null), VIDA_ENTRADA);
    return () => window.clearTimeout(id);
  }, [claveUltima]);

  const moverCamara = useCallback((top) => {
    const el = refContenedor.current;
    if (!el) return;
    const destino = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
    const c = camara.current;
    if (Math.abs(destino - el.scrollTop) < UMBRAL_MANUAL) {
      // No merece la pena moverse, pero sí reencajar el ancla: si el tablero
      // acaba de encoger (tile_demolition), el navegador ya ha recortado el
      // scroll y ese salto no lo ha hecho nadie con el dedo.
      c.ancla = el.scrollTop;
      return;
    }
    window.clearTimeout(c.vuelo);
    c.ancla = destino;
    // Mientras dure el vuelo, los eventos de scroll son nuestros y no del
    // usuario. El techo de tiempo existe porque el scroll suave no avisa de que
    // ha terminado y sin él la cámara se quedaría sorda.
    c.vuelo = window.setTimeout(() => { c.vuelo = 0; }, VUELO_CAMARA);
    // jsdom no implementa scrollTo; sin el respaldo, cualquier test que monte
    // la partida reventaría aquí por algo que no es el fallo que busca.
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: destino });
    else el.scrollTop = destino;
  }, []);

  const alDesplazar = useCallback(() => {
    const el = refContenedor.current;
    if (!el) return;
    const c = camara.current;
    if (c.vuelo) {
      if (Math.abs(el.scrollTop - c.ancla) <= 1) {
        window.clearTimeout(c.vuelo);
        c.vuelo = 0;
      }
      return;
    }
    // Umbral: un toque en táctil genera 1-3 px de temblor y no es una intención.
    if (Math.abs(el.scrollTop - c.ancla) <= UMBRAL_MANUAL) return;
    c.ancla = el.scrollTop;
    setCamaraManual(true);
    window.clearTimeout(c.espera);
    c.espera = window.setTimeout(() => setCamaraManual(false), ESPERA_MANUAL);
  }, []);

  // Seguir la jugada: encuadrar los dos extremos abiertos y la última ficha.
  useEffect(() => {
    const el = refContenedor.current;
    if (!el || camaraManual || !medido || trazo.items.length === 0) return;
    const ultima = claveUltima
      ? trazo.items.find((it) => claveFicha(it.tile) === claveUltima)
      : null;
    const caja = cajaDeLaJugada(trazo, escala, geom.margen, ultima);
    if (!caja) return;
    const arriba = caja.arriba - AIRE_CAMARA;
    const abajo = caja.abajo + AIRE_CAMARA;
    // Si la jugada ya se ve entera no se toca nada: mover la mesa sin necesidad
    // marea y además pelea con quien esté leyendo otra parte de la cadena.
    if (arriba >= el.scrollTop && abajo <= el.scrollTop + el.clientHeight) {
      camara.current.ancla = el.scrollTop;
      return;
    }
    moverCamara((arriba + abajo) / 2 - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardSignature, escala, camaraManual, medido, reencuadre]);

  // Al empezar ronda la cámara vuelve sola. Es la otra mitad del fallo de
  // manualView: no sólo se encendía sin querer, es que tampoco se apagaba nunca
  // (GameBoard no se remonta entre rondas).
  const tableroVacio = board.length === 0;
  useEffect(() => {
    if (tableroVacio) setCamaraManual(false);
  }, [tableroVacio]);

  useEffect(() => {
    const c = camara.current;
    return () => {
      window.clearTimeout(c.vuelo);
      window.clearTimeout(c.espera);
    };
  }, []);

  const ajustarVista = useCallback(() => {
    setCamaraManual(false);
    setReencuadre((n) => n + 1);
  }, []);

  // Alternativa textual del lienzo. Las fichas van aria-hidden: en doble-9
  // serían 51 paradas de lector para leer una figura, y el relato completo de
  // la partida ya lo da la crónica.
  const resumen = t('a11y.tableroResumen', {
    n: board.length,
    izq: tableroVacio ? '—' : board[0][0],
    der: tableroVacio ? '—' : board[board.length - 1][1],
  });

  return (
    <div ref={refContenedor} className="game-board-container" onScroll={alDesplazar}>
      <div className="mesa-controles">
        <button type="button" onClick={ajustarVista} title={t('board.center')}>
          <Maximize2 size={16} aria-hidden="true" />
          <span>{t('board.center')}</span>
        </button>
        <button type="button" onClick={() => setShowMoveLog(true)} title={t('log.title')}>
          <ScrollText size={16} aria-hidden="true" />
          <span>{t('log.title')}</span>
        </button>
        {/* El cuadro de torneo se queda aquí: hoy es el ÚNICO camino a
            showBracket, y moverlo a la barra sin llevárselo entero lo perdería. */}
        {onOpenBracket && (
          <button type="button" onClick={onOpenBracket} title={t('tourney.title')}>
            <Trophy size={16} aria-hidden="true" />
            <span>{t('tourney.short')}</span>
          </button>
        )}
      </div>

      {camaraManual && (
        <button
          type="button"
          className="mesa-seguir"
          onClick={ajustarVista}
          title={t('a11y.vistaManual')}
        >
          {t('a11y.seguirJugada')}
        </button>
      )}

      {tableroVacio ? (
        <div className="mesa-vacia">
          <strong>{t('board.empty')}</strong>
          <span>{t('board.emptyHint')}</span>
          {isMyTurn && selectedTileIndex !== null && (
            <button
              type="button"
              onClick={() => onPlay && onPlay(selectedTileIndex, 'left')}
              className="board-placeholder-circle animate-pulse-glow"
              style={{ marginTop: '16px' }}
              title="Colocar primera ficha"
            >
              ＋
            </button>
          )}
          {isMyTurn && pendingTargetType === 'end_target' && (
            <div style={{ display: 'flex', gap: '16px', marginTop: '16px', zIndex: 30 }}>
              <button
                type="button"
                onClick={() => onSelectEndTarget && onSelectEndTarget('left')}
                className="board-placeholder-circle"
                style={{ borderStyle: 'dashed', borderColor: '#818cf8', color: '#a5b4fc' }}
              >
                {selectedPower?.id === 'tile_demolition' ? '💣' : '❄️'} Izq
              </button>
              <button
                type="button"
                onClick={() => onSelectEndTarget && onSelectEndTarget('right')}
                className="board-placeholder-circle"
                style={{ borderStyle: 'dashed', borderColor: '#818cf8', color: '#a5b4fc' }}
              >
                {selectedPower?.id === 'tile_demolition' ? '💣' : '❄️'} Der
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className="mesa-lienzo"
          role="img"
          aria-label={resumen}
          tabIndex={0}
          style={{ width: trazo.w * escala, height: trazo.h * escala }}
        >
          <div
            className="mesa-plano"
            style={{
              width: trazo.w,
              height: trazo.h,
              transform: `scale(${escala})`,
              // Oculto hasta la primera medida real: sin esto el primer trazado
              // sale con un perRow inventado y se ve reacomodarse.
              visibility: medido ? undefined : 'hidden',
            }}
          >
            {trazo.items.map((item) => {
              const clave = claveFicha(item.tile);
              const esUltima = claveUltima !== null && clave === claveUltima;
              const entrando = esUltima && fichaNueva === clave;
              const esDoble = item.tile[0] === item.tile[1];
              return (
                <div
                  key={clave}
                  aria-hidden="true"
                  className={`board-tile-wrap ${esUltima ? 'last-played' : ''} ${entrando && esDoble ? 'double-impact' : ''}`}
                  title={esUltima && nombreUltimo ? t('board.lastTile', { name: nombreUltimo }) : undefined}
                  style={{
                    left: item.cx - trazo.minX + geom.margen,
                    top: item.cy - trazo.minY + geom.margen,
                    width: item.w,
                    height: item.h,
                    // Anillo de identidad de quien la jugó, en vez del halo
                    // verde genérico que era igual para los cuatro.
                    '--color-jugador': esUltima && jugadaPor ? colorDeJugador(jugadaPor) : undefined,
                  }}
                >
                  {entrando && esDoble && <div className="shockwave-burst" />}
                  {/* La animación de caída actúa sólo sobre la ficha entrante:
                      envolverla aquí evita re-animar el tablero entero. */}
                  <div className={`board-tile-anim ${entrando ? 'animate-tile-drop' : ''}`}>
                    <DominoTile tile={item.display} horizontal={item.horizontal} />
                  </div>
                </div>
              );
            })}

            {/* Controles del Extremo Izquierdo */}
            {trazo.leftPos && (
              <div
                style={{
                  position: 'absolute',
                  left: trazo.leftPos.x - 32 - trazo.minX + geom.margen,
                  top: trazo.leftPos.y - trazo.minY + geom.margen,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 20,
                  transition: 'left 0.4s ease-out, top 0.4s ease-out',
                }}
              >
                {isMyTurn && canPlayLeft && pendingTargetType !== 'end_target' && (
                  <button
                    type="button"
                    onClick={() => onPlay && onPlay(selectedTileIndex, 'left')}
                    className="board-placeholder-circle animate-pulse-glow"
                    title="Jugar extremo izquierdo"
                  >
                    ←
                  </button>
                )}
                {(activeEffects?.frozenEnd === 'left' || activeEffects?.frozenEnd === 'both') && (
                  <div className="board-placeholder-circle frozen" title="Extremo Congelado" />
                )}
                {isMyTurn && pendingTargetType === 'end_target' && (
                  <button
                    type="button"
                    onClick={() => onSelectEndTarget && onSelectEndTarget('left')}
                    className="board-placeholder-circle"
                    style={{ borderStyle: 'dashed', borderColor: '#818cf8', color: '#a5b4fc' }}
                    title={selectedPower?.id === 'tile_demolition' ? 'Eliminar Ficha Izquierda' : 'Congelar Extremo Izquierdo'}
                  >
                    {selectedPower?.id === 'tile_demolition' ? '💣' : '❄️'}
                  </button>
                )}
              </div>
            )}

            {/* Controles del Extremo Derecho */}
            {trazo.rightPos && (
              <div
                style={{
                  position: 'absolute',
                  left: trazo.rightPos.x + (trazo.items[trazo.items.length - 1]?.dir || 1) * 32 - trazo.minX + geom.margen,
                  top: trazo.rightPos.y - trazo.minY + geom.margen,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 20,
                  transition: 'left 0.4s ease-out, top 0.4s ease-out',
                }}
              >
                {isMyTurn && canPlayRight && pendingTargetType !== 'end_target' && (
                  <button
                    type="button"
                    onClick={() => onPlay && onPlay(selectedTileIndex, 'right')}
                    className="board-placeholder-circle animate-pulse-glow"
                    title="Jugar extremo derecho"
                  >
                    →
                  </button>
                )}
                {(activeEffects?.frozenEnd === 'right' || activeEffects?.frozenEnd === 'both') && (
                  <div className="board-placeholder-circle frozen" title="Extremo Congelado" />
                )}
                {isMyTurn && pendingTargetType === 'end_target' && (
                  <button
                    type="button"
                    onClick={() => onSelectEndTarget && onSelectEndTarget('right')}
                    className="board-placeholder-circle"
                    style={{ borderStyle: 'dashed', borderColor: '#818cf8', color: '#a5b4fc' }}
                    title={selectedPower?.id === 'tile_demolition' ? 'Eliminar Ficha Derecha' : 'Congelar Extremo Derecho'}
                  >
                    {selectedPower?.id === 'tile_demolition' ? '💣' : '❄️'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showMoveLog && <MoveLog moveLog={moveLog} onClose={() => setShowMoveLog(false)} />}
    </div>
  );
}
