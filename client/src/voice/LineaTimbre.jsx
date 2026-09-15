import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import useModalA11y from '../hooks/useModalA11y';
import { useT } from '../i18n/LanguageContext';
import { useGameStore } from '../store/useGameStore';
import { useSocialStore } from '../social/useSocialStore';
import { colorDeJugador } from '../utils/colorDeJugador';
import { iniciarTimbre, pararTimbre } from '../audio';
import { useLineaStore, acciones } from './useLineaStore';

/**
 * EL TIMBRE. Un solo nodo en toda la aplicación, montado por `LineaGlobal`.
 *
 * Hasta ahora la tarjeta de llamada entrante se pintaba HASTA TRES VECES a la
 * vez, con tres botones de «Aceptar» distintos: las ramas del entrante y del
 * saliente de `UnifiedVoiceWidget` iban ANTES que sus filtros por `variant`, y
 * había tres instancias vivas (el flotante del marco, la de `GameBar` y la del
 * tablero de tres en raya). Tres tarjetas, tres cuentas atrás y tres formas de
 * contestar la misma llamada. Aquí hay una, y las superficies contextuales
 * (la cápsula anclada) son SÓLO controles.
 *
 * ARRIBA, NO ABAJO, y es una decisión: el borde inferior de la pantalla es donde
 * viven la mano de fichas y el riel de extremos. Una tarjeta que aparece de
 * golpe bajo el pulgar durante un turno es una jugada accidental.
 *
 * RECHAZAR VA A LA IZQUIERDA: la acción destructiva-por-accidente no puede caer
 * bajo el pulgar en reposo.
 *
 * NO ES UNA REGIÓN VIVA. Es `role="alertdialog"` con `aria-modal="false"`: toma
 * el foco y se anuncia por su título, pero NO apaga el resto de la pantalla, así
 * que durante una partida se puede tabular fuera y seguir jugando. Las tres
 * regiones vivas de la partida ya están gastadas (CONTRATO §7).
 */

/** Cada cuánto alterna el título de la pestaña mientras suena. */
const PARPADEO_MS = 900;

/** Patrón de vibración del timbre, repetido al ritmo de la ráfaga sonora. */
const VIBRACION = [180, 120, 180];
const VIBRACION_CADA_MS = 2400;

/** Vibración corta del timbre SUPRIMIDO por la regla del reloj. */
const VIBRACION_CORTA = 30;

/**
 * LA REGLA DEL RELOJ. Con la partida en marcha, en mi turno y diez segundos o
 * menos en el reloj, el timbre no toma el foco y no suena: degrada a insignia en
 * el chip de la barra y una vibración corta.
 *
 * El rediseño de la partida gastó sus dos `role="alert"` en los avisos de 10 s y
 * 5 s, y el riel entero existe para que un turno sea una decisión de diez
 * segundos. Un movimiento de foco en el segundo 8 de una final es una partida
 * perdida — y el que llama no sabe que estás en una.
 */
const RELOJ_APRETADO = 10;

function segundosDeTurno(gameState) {
  if (!gameState) return null;
  if (Number.isFinite(gameState.turnEndsAt)) {
    return Math.max(0, Math.ceil((gameState.turnEndsAt - Date.now()) / 1000));
  }
  if (Number.isFinite(gameState.turnSecondsRemaining)) return gameState.turnSecondsRemaining;
  return null;
}

function segundosHasta(expiraEn) {
  if (!Number.isFinite(expiraEn)) return null;
  return Math.max(0, Math.ceil((expiraEn - Date.now()) / 1000));
}

/** Cuenta atrás del timbre. Va aparte para que el tic de cada segundo no
 *  vuelva a renderizar la tarjeta entera ni reevalúe la regla del reloj. */
function CuentaAtras({ expiraEn }) {
  const [segundos, setSegundos] = useState(() => segundosHasta(expiraEn));

  useEffect(() => {
    setSegundos(segundosHasta(expiraEn));
    if (!Number.isFinite(expiraEn)) return undefined;
    const id = setInterval(() => setSegundos(segundosHasta(expiraEn)), 1000);
    return () => clearInterval(id);
  }, [expiraEn]);

  if (segundos == null) return null;
  // aria-hidden: un número que cambia cada segundo dentro de un diálogo que
  // acaba de tomar el foco se releería encima de los dos botones.
  return <span className="linea-timbre-reloj" aria-hidden="true">{segundos}</span>;
}

export default function LineaTimbre() {
  const { t } = useT();
  const estado = useLineaStore(s => s.estado);
  const entrante = useLineaStore(s => s.entrante);
  const gameState = useGameStore(s => s.gameState);
  const playerId = useGameStore(s => s.playerId);
  const amigos = useSocialStore(s => s.amigos);

  // Ticker de la supresión. Sólo corre mientras el timbre está callado por el
  // reloj: la tarjeta tiene que aparecer sola cuando acaba el turno, y el
  // `turnEndsAt` del store es una marca fija que no vuelve a renderizar nada.
  const [, tic] = useState(0);

  const sonando = estado === 'entrante' && !!entrante;

  const segundosTurno = segundosDeTurno(gameState);
  const esMiTurno = !!gameState && gameState.status === 'playing'
    && !!playerId && gameState.currentPlayerId === playerId;
  const suprimido = sonando && esMiTurno
    && segundosTurno != null && segundosTurno <= RELOJ_APRETADO;

  useEffect(() => {
    if (!suprimido) return undefined;
    const id = setInterval(() => tic(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [suprimido]);

  // Los tres canales. Hoy no hay ninguno: `animate-pulse` es una clase de
  // Tailwind en un proyecto sin Tailwind (no está definida en ninguna hoja),
  // `audio.js` no tenía tono de llamada y nadie llamaba a `navigator.vibrate`
  // en el camino de la voz. El tercero —el título de la pestaña— es el único
  // que funciona seguro con la pestaña en segundo plano, que es el caso más
  // probable de todos.
  const tituloPrevio = useRef('');
  useEffect(() => {
    if (!sonando || suprimido) {
      if (suprimido) {
        try { if (navigator.vibrate) navigator.vibrate(VIBRACION_CORTA); } catch { /* sin gesto previo */ }
      }
      return undefined;
    }

    iniciarTimbre();

    const vibrar = () => {
      try { if (navigator.vibrate) navigator.vibrate(VIBRACION); } catch { /* sin gesto previo */ }
    };
    vibrar();
    const idVibra = setInterval(vibrar, VIBRACION_CADA_MS);

    tituloPrevio.current = document.title;
    const aviso = `☎ ${entrante.fromName || ''}`.trim();
    let alterno = true;
    const idTitulo = setInterval(() => {
      document.title = alterno ? aviso : tituloPrevio.current;
      alterno = !alterno;
    }, PARPADEO_MS);
    document.title = aviso;

    return () => {
      pararTimbre();
      clearInterval(idVibra);
      clearInterval(idTitulo);
      try { if (navigator.vibrate) navigator.vibrate(0); } catch { /* ídem */ }
      document.title = tituloPrevio.current;
    };
  }, [sonando, suprimido, entrante]);

  // El hook se llama SIEMPRE, también cuando no hay timbre: es la regresión A-4
  // (un `return` condicional por encima de un hook) y ya se coló dos veces en
  // este proyecto. Sin panel montado no hace nada.
  //
  // EL FOCO ENTRA EN EL TÍTULO, NO EN «CONTESTAR», y es a propósito. El hook
  // enfoca el `[data-modal-titulo]` si existe y, si no, la primera parada de
  // tabulación — que aquí es «Rechazar», porque el diseño lo pone a la
  // izquierda y el orden del DOM tiene que coincidir con el visual. Con el foco
  // en un botón, la tecla más probable de quien acaba de oír un timbre (Intro)
  // o rechaza la llamada del otro con su enfriamiento de cinco minutos, o le
  // abre el micrófono sin querer. Sobre el título no hace nada, el lector
  // anuncia quién llama, y un Tab lleva a cada botón por su nombre.
  const { propsPanel, propsTitulo } = useModalA11y(
    acciones.rechazar,
    { aislar: false, rol: 'alertdialog' }
  );

  if (!sonando || suprimido) return null;

  const esMesa = entrante.clase === 'mesa';
  const nombre = entrante.fromName || '';
  const quienLlama = amigos.find(a => a.id === entrante.fromPlayerId);
  const dondeEsta = quienLlama && quienLlama.actividad ? quienLlama.actividad.estado : null;
  // Sólo se dice de dónde llaman cuando se sabe de verdad. Saber si el otro
  // está jugando cambia si contestas; inventarlo, no.
  const contexto = dondeEsta === 'jugando' || dondeEsta === 'en_sala'
    ? t('linea.timbreDesdePartida')
    : (dondeEsta === 'libre' ? t('linea.timbreDesdeLobby') : '');

  return (
    <div className="linea-timbre" {...propsPanel}>
      <div className="linea-timbre-cabecera">
        <span
          className="linea-timbre-avatar"
          aria-hidden="true"
          style={{
            background: `color-mix(in srgb, ${colorDeJugador(entrante.fromPlayerId || nombre)} 22%, var(--sup-2))`,
            borderColor: colorDeJugador(entrante.fromPlayerId || nombre)
          }}
        >
          <Phone size={20} />
        </span>

        <span className="linea-timbre-quien">
          <span className="linea-timbre-nombre" {...propsTitulo}>
            {esMesa ? t('linea.timbreLaMesa') : `${nombre} ${t('linea.timbreTeLlama')}`}
          </span>
          {!esMesa && contexto && (
            <span className="linea-timbre-donde">{contexto}</span>
          )}
        </span>

        <CuentaAtras expiraEn={entrante.expiraEn} />
      </div>

      <div className="linea-timbre-acciones">
        {/* Rechazar A LA IZQUIERDA, y los dos con texto real: dos iconos de
            teléfono verde y rojo se distinguen mal y no se distinguen nada en
            escala de grises. */}
        <button type="button" className="linea-btn linea-btn-rechazar" onClick={acciones.rechazar}>
          <PhoneOff size={16} aria-hidden="true" />
          {t('linea.rechazar')}
        </button>
        <button type="button" className="linea-btn linea-btn-contestar" onClick={acciones.aceptar}>
          <Phone size={16} aria-hidden="true" />
          {t('linea.contestar')}
        </button>
      </div>
    </div>
  );
}
