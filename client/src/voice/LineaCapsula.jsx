import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ChevronUp, Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import { useLineaStore, acciones } from './useLineaStore';
import { CLAVE_DE_CIERRE, CON_MICRO } from './maquina';

/**
 * LA CÁPSULA: el resumen de la línea, y el único control permanente que la voz
 * tiene fuera de la hoja.
 *
 * Dos variantes, una sola pieza:
 *
 * · `libre` — barra fija de 48 px abajo, para el hub, el lobby, la sala de
 *   espera y el espectador. Barra ancha y no píldora: en un teléfono el pulgar
 *   llega mejor a una barra. EN REPOSO NO EXISTE: un botón permanente de «voz»
 *   en una esquina es ruido, y la puerta a la voz es el carril de gente.
 *
 * · `anclada` — chip de 32 px DENTRO de los 40 de `.game-bar`, en el hueco que
 *   ocupaba `<VoiceChat/>`. En reposo dentro de una sala es un botón REAL de
 *   «Entrar a la voz»; hasta ahora ese nodo existía y `perfil-hub.css:2090` lo
 *   escondía con `display:none`, así que la voz dentro de la partida no tenía
 *   literalmente ninguna superficie. No cuesta ni un píxel del reparto vertical:
 *   el área táctil de 44 la pone un pseudo-elemento que desborda la barra.
 *
 * ESTE ARCHIVO PUBLICA ADEMÁS LAS PIEZAS QUE LA HOJA REPITE EN LARGO —el
 * resumen de estado, las barras de calidad y su palabra—. Están aquí y no
 * duplicadas allí para que la cápsula y la hoja NO PUEDAN DISCREPAR: dos
 * cálculos del mismo estado acaban diciendo cosas distintas del mismo momento,
 * que es exactamente el defecto que este paquete viene a cerrar.
 */

/**
 * Si la hoja está abierta. Vive fuera de React porque sus dos disparadores están
 * en ramas distintas del árbol —la cápsula anclada la monta `GameBar`, la libre
 * `LineaGlobal`— y la hoja tiene que ser UNA. Con el estado dentro de cada
 * cápsula habría dos hojas o ninguna, según cuál se pulsara.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useHoja = create((set) => ({
  abierta: false,
  abrir: () => set({ abierta: true }),
  cerrar: () => set({ abierta: false }),
  alternar: () => set((s) => ({ abierta: !s.abierta }))
}));

/**
 * Con quién hablábamos la última vez. `cerrar()` vacía `saliente` y `entrante`
 * —y hace bien: son la llamada en curso, y ya no hay ninguna—, así que sin esto
 * el [Volver a llamar] del resumen no tendría a quién llamar. Es estado de
 * presentación, no de la máquina, y por eso vive aquí.
 */
let ultimoInterlocutor = null;

// eslint-disable-next-line react-refresh/only-export-components
export function useUltimoInterlocutor() {
  const saliente = useLineaStore((s) => s.saliente);
  const entrante = useLineaStore((s) => s.entrante);

  useEffect(() => {
    if (saliente && saliente.targetPlayerId) {
      ultimoInterlocutor = { id: saliente.targetPlayerId, nombre: saliente.targetName || '' };
    } else if (entrante && entrante.fromPlayerId) {
      ultimoInterlocutor = { id: entrante.fromPlayerId, nombre: entrante.fromName || '' };
    }
  }, [saliente, entrante]);

  return ultimoInterlocutor;
}

/**
 * Los ocho estados de `calidad.js`, de mejor a peor. El orden ES la definición
 * de «el participante en peor estado», que es lo que resume la cápsula.
 */
const ORDEN_CALIDAD = [
  'enlazado_bien', 'enlazado_justo', 'inestable', 'ausente', 'probando', 'negociando', 'sin_ruta'
];

/**
 * Palabra de cada estado. `enlazado_bien` NO tiene: tres barras verdes ya lo
 * dicen y una etiqueta «Bien» permanente es ruido. Todos los demás la llevan,
 * porque la calidad no puede depender sólo del número de barras ni del color:
 * un daltónico lee el estado en la palabra.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const PALABRA_DE_CALIDAD = {
  enlazado_bien: '',
  enlazado_justo: 'linea.justo',
  inestable: 'linea.inestable',
  sin_ruta: 'linea.sinRuta',
  negociando: 'linea.enlazando',
  probando: 'linea.enlazando',
  ausente: 'linea.recuperandoN'
};

/** Cuántas barras se encienden por estado. */
const BARRAS_DE_CALIDAD = {
  enlazado_bien: 3,
  enlazado_justo: 2,
  inestable: 1,
  ausente: 1,
  probando: 1,
  negociando: 0,
  sin_ruta: 0
};

/** El participante en PEOR estado, que es del que informa la cápsula. */
// eslint-disable-next-line react-refresh/only-export-components
export function peorPar(pares) {
  const vivos = Object.values(pares || {}).filter((e) => e && e !== 'ido');
  if (vivos.length === 0) return null;
  let peor = vivos[0];
  for (const estado of vivos) {
    if (ORDEN_CALIDAD.indexOf(estado) > ORDEN_CALIDAD.indexOf(peor)) peor = estado;
  }
  return peor;
}

/**
 * Medidor de calidad de un par: tres barras Y su palabra. `sin_ruta` añade el
 * glifo ⚠, porque «cero barras» y «todavía negociando» se dibujan igual y no
 * significan lo mismo.
 */
export function BarrasDeCalidad({ estado, conPalabra = false, segundosAusente = 0 }) {
  const { t } = useT();
  if (!estado || estado === 'ido') return null;
  const encendidas = BARRAS_DE_CALIDAD[estado] ?? 0;
  const clave = PALABRA_DE_CALIDAD[estado];
  const palabra = clave
    ? (clave === 'linea.recuperandoN' ? t(clave, { n: segundosAusente }) : t(clave))
    : '';

  return (
    <span className={`linea-barras linea-barras-${estado}`}>
      <span className="linea-barras-grafico" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <i key={i} className={i < encendidas ? 'viva' : ''} />
        ))}
        {estado === 'sin_ruta' && <b className="linea-barras-alerta">⚠</b>}
      </span>
      {conPalabra && palabra && <span className="linea-barras-palabra">{palabra}</span>}
    </span>
  );
}

/** Segundos transcurridos desde una marca, con el reloj parado si no toca. */
function useSegundos(activo, desde) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!activo || !desde) { setN(0); return undefined; }
    const calcular = () => setN(Math.max(0, Math.round((Date.now() - desde) / 1000)));
    calcular();
    const id = setInterval(calcular, 1000);
    return () => clearInterval(id);
  }, [activo, desde]);
  return n;
}

/**
 * QUÉ DICE LA LÍNEA AHORA MISMO, en una frase y ya traducida.
 *
 * La regla que gobierna toda esta función: no afirmar más de lo que se sabe.
 * `abierta` sólo llega cuando algún par tiene bytes de audio medidos, así que
 * aquí «Línea abierta» significa que entra sonido, no que el servidor haya
 * dicho que sí. Antes esta misma frase («Conectado P2P») se pintaba en cuanto se
 * aceptaba la llamada, antes de que existiera una sola RTCPeerConnection.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useResumenDeLinea() {
  const { t } = useT();
  const estado = useLineaStore((s) => s.estado);
  const motivo = useLineaStore((s) => s.motivo);
  const desde = useLineaStore((s) => s.desde);
  const miembros = useLineaStore((s) => s.miembros);
  const saliente = useLineaStore((s) => s.saliente);
  const micError = useLineaStore((s) => s.micError);
  const enOtraPestana = useLineaStore((s) => s.enOtraPestana);

  const contando = estado === 'enlazando' || estado === 'recuperando';
  const segundos = useSegundos(contando, desde);

  const otros = Math.max(0, (miembros || []).length - 1);

  let texto = '';
  switch (estado) {
    case 'pidiendoMicro':
      texto = t('linea.pidiendoMicro');
      break;
    case 'saliente':
      texto = saliente && saliente.targetName
        ? `${t('voice.calling')} ${saliente.targetName}`
        : t('voice.calling');
      break;
    case 'enlazando':
      texto = t('linea.enlazandoN', { n: segundos });
      break;
    case 'abierta':
      texto = otros === 1
        ? `${t('linea.abierta')} · ${(miembros.find((m) => m.name) || {}).name || ''}`.trim()
        : `${t('linea.abierta')} · ${t('linea.nEnLaVoz', { n: miembros.length })}`;
      break;
    case 'fragil':
      texto = t('linea.fragil');
      break;
    case 'sinRuta':
      texto = t('linea.sinRutaTitulo');
      break;
    case 'recuperando':
      texto = t('linea.recuperandoN', { n: segundos });
      break;
    case 'cerrada':
      // Un fallo de micrófono se explica con SU mensaje, no con «Llamada
      // terminada»: la clave la trae el propio fallo desde mediosLocales, que
      // es el módulo que conoce la taxonomía del navegador.
      texto = String(motivo || '').startsWith('micro_') && micError
        ? t(micError.clave)
        : t(CLAVE_DE_CIERRE[motivo] || 'linea.colgada');
      break;
    default:
      texto = enOtraPestana ? t('linea.enOtraPestana') : '';
  }

  return { estado, motivo, texto, segundos, otros };
}

/* ─────────────────────────────────────────────────────────── la cápsula */

export default function LineaCapsula({ variante = 'libre' }) {
  const { t } = useT();
  const resumen = useResumenDeLinea();
  const pares = useLineaStore((s) => s.pares);
  const muted = useLineaStore((s) => s.muted);
  const timbrando = useLineaStore((s) => s.timbrando);
  const vozDeMesa = useLineaStore((s) => s.vozDeMesa);
  const abrirHoja = useHoja((s) => s.abrir);
  const alternarHoja = useHoja((s) => s.alternar);
  useUltimoInterlocutor();

  const { estado } = resumen;
  const hayLinea = estado !== 'inactiva' && estado !== 'entrante';
  const conMicro = CON_MICRO.includes(estado);
  const peor = peorPar(pares);
  // Timbres en espera: con la línea ocupada el timbre no roba la pantalla, se
  // apunta. Y con la regla del reloj, esta insignia es TODA la señal visible.
  const enEspera = (timbrando || []).length;

  /* ─── Variante anclada: el chip de la barra de la partida ─── */
  if (variante === 'anclada') {
    if (!hayLinea) {
      const n = vozDeMesa && vozDeMesa.n ? vozDeMesa.n : 0;
      // DOS controles y no uno. El de la izquierda conserva el gesto de siempre
      // —entrar a la voz de la mesa de un toque, que es lo que se hace a
      // menudo—; el de la derecha abre la hoja, que es la ÚNICA forma de llamar
      // a un amigo sin salir de la partida. Con un solo botón había que entrar
      // antes a la voz de la mesa o volverse al hub, y eso incumplía el encargo.
      return (
        <>
          <button
            type="button"
            className="linea-chip linea-chip-entrar"
            onClick={acciones.entrarAMesa}
            title={n > 0 ? t('linea.entrarVozN', { n }) : t('linea.entrarVoz')}
            aria-label={n > 0 ? t('linea.entrarVozN', { n }) : t('linea.entrarVoz')}
          >
            <Mic size={14} aria-hidden="true" />
            {n > 0 && <span className="linea-chip-n">{n}</span>}
          </button>
          <button
            type="button"
            className="linea-chip linea-chip-hoja"
            onClick={abrirHoja}
            title={t('linea.abrirLinea')}
            aria-label={t('linea.abrirLinea')}
          >
            <Phone size={14} aria-hidden="true" />
            {enEspera > 0 && <span className="linea-chip-insignia" aria-hidden="true">{enEspera}</span>}
          </button>
        </>
      );
    }

    return (
      <button
        type="button"
        className={`linea-chip linea-chip-viva ${muted ? 'linea-chip-mudo' : ''}`}
        onClick={alternarHoja}
        title={`${resumen.texto} · ${t('linea.expandir')}`}
        aria-label={`${resumen.texto} · ${t('linea.expandir')}`}
      >
        {muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
        <BarrasDeCalidad estado={peor} />
        {enEspera > 0 && <span className="linea-chip-insignia" aria-hidden="true">{enEspera}</span>}
      </button>
    );
  }

  /* ─── Variante libre: la barra fija de fuera de la partida ─── */

  // En reposo NO se devuelve null, y esto es el arreglo del requisito, no un
  // adorno. Devolverlo dejaba al hub, al lobby, al ESPECTADOR y al TORNEO sin
  // ninguna forma de EMPEZAR una llamada: el timbre sí estaba siempre (se podía
  // recibir), pero para llamar había que pasar por el carril del hub o por el
  // modal de amigos, y ninguno de los dos existe en esas dos vistas. El lanzador
  // abre la hoja, que es donde se llama a alguien y donde se entra a la mesa.
  if (!hayLinea) {
    return (
      <div className="linea-pila">
        <button
          type="button"
          className="linea-lanzador"
          onClick={abrirHoja}
          title={t('linea.abrirLinea')}
          aria-label={t('linea.abrirLinea')}
        >
          <Phone size={18} aria-hidden="true" />
          {enEspera > 0 && <span className="linea-chip-insignia" aria-hidden="true">{enEspera}</span>}
        </button>
      </div>
    );
  }

  return (
    // `role="status"` sólo aquí: fuera de la partida la cápsula no compite con
    // nada. Dentro NO lleva ninguna —las tres regiones vivas de la mesa están
    // gastadas— y sus cambios se cuentan por la crónica.
    <div className="linea-pila">
      <div className="linea-capsula" role="status">
        <BarrasDeCalidad estado={peor} />

        <span className="linea-capsula-texto">{resumen.texto}</span>

        <div className="linea-capsula-controles">
          {conMicro && (
            <button
              type="button"
              className={`linea-btn-icono ${muted ? 'activo' : ''}`}
              onClick={acciones.alternarSilencio}
              title={t('linea.atajoSilenciar')}
              aria-label={muted ? t('voice.unmute') : t('voice.mute')}
              aria-pressed={muted}
            >
              {muted ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            </button>
          )}

          {(conMicro || estado === 'pidiendoMicro') && (
            <button
              type="button"
              className="linea-btn-icono linea-colgar"
              onClick={estado === 'saliente' || estado === 'pidiendoMicro' ? acciones.cancelar : acciones.colgar}
              aria-label={estado === 'saliente' || estado === 'pidiendoMicro' ? t('linea.cancelar') : t('linea.colgar')}
            >
              <PhoneOff size={18} aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            className="linea-btn-icono"
            onClick={abrirHoja}
            aria-label={t('linea.expandir')}
          >
            <ChevronUp size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
