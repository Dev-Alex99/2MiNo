import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, Crown, MessageSquare, Mic, Shield, Zap } from 'lucide-react';
import { useVoice } from '../voice/VoiceContext';
import { useT } from '../i18n/LanguageContext';
import { colorDeJugador } from '../utils/colorDeJugador';
import { MOSTRAR_NIVEL_BOT } from '../games/domino/mesaConfig';

/**
 * Cinta de turno: la fila de chips que sustituye a los asientos flotantes.
 *
 * Los asientos se pintaban en posición absoluta ENCIMA del tablero, así que
 * había que descontarles 170 de los 375 px de ancho en móvil aunque en 1 contra
 * 1 solo existiera uno. La cinta está en flujo: cuesta 56 px de alto y cero de
 * ancho, y de ese intercambio sale casi toda la ganancia de tamaño de la ficha.
 *
 * Además le da al jugador un sitio propio en la mesa: su chip es el primero y
 * siempre está. Los asientos solo dibujaban rivales.
 */

// Silueta de ficha para el recuento de la mano. Se construye una sola vez: el
// contador cambia en cada jugada y no hace falta rehacer los nodos.
const SILUETAS_FICHA = Array.from({ length: 15 }).map((_, i) => <i key={i} />);

// Tope de siluetas por chip. En un chip de 76 px caben siete; el número exacto
// va siempre al lado, así que el tope recorta el dibujo, nunca el dato.
const MAX_SILUETAS = 7;

// Tope de números fallados que se pintan. El resto se resume en un "+N" para no
// afirmar que el jugador solo ha fallado tres cosas; la etiqueta accesible
// enumera todos.
const MAX_FALLOS = 3;

// Glifo de equipo. El canto de color no basta: en modo parejas el compañero NO
// queda enfrente (la cinta ordena por turno), así que hay que poder distinguir
// los dos bandos sin depender del color.
const GLIFO_EQUIPO = ['◆', '●'];

// Referencia compartida para "este jugador no ha fallado nada". Crear un array
// vacío por chip y por render haría inútil el React.memo del chip.
const SIN_FALLOS = [];

const CLAVE_NIVEL = {
  facil: 'wait.difEasy',
  normal: 'wait.difNormal',
  dificil: 'wait.difHard',
  maestro: 'wait.difMaster'
};
const MUESCAS_NIVEL = { facil: 1, normal: 2, dificil: 3, maestro: 4 };

// Los dos únicos avisos del reloj, en orden descendente de tiempo restante. Son
// exactamente dos por turno: anunciar el reloj cada segundo haría inservible un
// lector de pantalla justo cuando más falta hace escuchar la mesa.
const UMBRALES_RELOJ = [
  { segundos: 10, tramo: 'aviso', clave: 'a11y.avisoDiezSegundos', vibra: true },
  { segundos: 5, tramo: 'critico', clave: 'a11y.avisoCincoSegundos', vibra: false }
];

function iniciales(nombre) {
  return String(nombre || '?').substring(0, 2).toUpperCase();
}

function vibrarAviso() {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate(10);
  } catch { /* algunos navegadores lanzan si no hubo gesto del usuario */ }
}

/**
 * Vídeo del rival dentro del chip. Copiado de SeatVideo (PlayerSeats.jsx:12-22):
 * el `srcObject` de un <video> no se puede poner por atributo, hay que
 * asignarlo por referencia, y `play()` rechaza si el usuario aún no interactuó.
 */
function VideoDeChip({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="cinta-video" />;
}

/**
 * Drenaje del canto del chip activo: UNA sola escritura de estilo por turno.
 *
 * El navegador interpola el resto en el compositor. Con un intervalo por segundo
 * el canto daría saltos visibles y forzaría un cálculo de estilo por tick en un
 * elemento que está siempre en pantalla.
 */
function useDrenajeReloj(ref, finMs, duracionMs) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (finMs == null) {
      el.style.transition = 'none';
      el.style.transform = 'scaleY(0)';
      return undefined;
    }

    const restanteMs = Math.max(0, finMs - Date.now());
    // Sin duración total no se puede saber qué fracción queda; el canto arranca
    // lleno y se vacía en el tiempo que reste. Sigue siendo cierto que "cuando
    // se acaba, se acaba tu turno", que es lo que la señal promete.
    const fraccion = duracionMs ? Math.min(1, restanteMs / duracionMs) : 1;

    el.style.transition = 'none';
    el.style.transform = `scaleY(${fraccion})`;
    void el.offsetWidth; // fuerza el reflujo para que la transición arranque aquí
    el.style.transition = `transform ${restanteMs}ms linear`;
    el.style.transform = 'scaleY(0)';
    return undefined;
  }, [ref, finMs, duracionMs]);
}

/** Numeral de segundos del chip activo. Va aparte para que el tic de cada
 *  segundo no vuelva a renderizar la cinta entera. */
function NumeralReloj({ finMs }) {
  const [segundos, setSegundos] = useState(() => segundosHasta(finMs));

  useEffect(() => {
    setSegundos(segundosHasta(finMs));
    if (finMs == null) return undefined;
    const id = setInterval(() => setSegundos(segundosHasta(finMs)), 1000);
    return () => clearInterval(id);
  }, [finMs]);

  if (segundos == null) return null;
  // aria-hidden: el reloj se anuncia dos veces por turno con role="alert", no
  // segundo a segundo.
  return <span className="cinta-reloj-numeral" aria-hidden="true">{segundos}</span>;
}

function segundosHasta(finMs) {
  if (finMs == null) return null;
  return Math.max(0, Math.ceil((finMs - Date.now()) / 1000));
}

const Chip = React.memo(function Chip({
  id, nombre, esBot, nivel, equipo, activo, esYo, habla, hablandoPorVoz,
  stream, escudo, enVoz, fichas, poderes, mostrarPoderes, fallos, esLider,
  blitzSegundos, objetivo, finMs, duracionMs, onSeleccionar
}) {
  const { t } = useT();
  const refDrenaje = useRef(null);
  useDrenajeReloj(refDrenaje, activo ? finMs : null, duracionMs);

  // La etiqueta se compone por trozos: el nivel solo existe en los bots, los
  // fallos solo si ha pasado alguna vez y "jugando ahora" solo en el chip del
  // turno. Con una plantilla única habría que rellenar los huecos que no tocan
  // con algo falso.
  const partes = [t('a11y.chip', { nombre, n: fichas, p: poderes })];
  if (esBot && MOSTRAR_NIVEL_BOT && CLAVE_NIVEL[nivel]) {
    partes.push(t('a11y.chipNivel', { nivel: t(CLAVE_NIVEL[nivel]) }));
  }
  if (fallos.length) partes.push(t('a11y.chipFallos', { nums: fallos.join(', ') }));
  // Estar en la voz de la mesa se DICE, no sólo se pinta: el micro de 10 px no
  // lo ve quien usa un lector, y hasta ahora tampoco lo veía nadie más —
  // `player.inVoice` sólo se encendía con `voice_join`, un evento que ningún
  // cliente emitía, así que era constante false.
  if (enVoz) partes.push(t('pres.enLlamada'));
  if (activo) partes.push(t('a11y.chipActivo'));

  const muescas = MOSTRAR_NIVEL_BOT && esBot ? MUESCAS_NIVEL[nivel] || 0 : 0;

  return (
    <div
      className={[
        'cinta-chip',
        activo ? 'cinta-chip-activo' : '',
        esYo ? 'cinta-chip-yo' : '',
        equipo === 0 || equipo === 1 ? `cinta-chip-equipo-${equipo}` : '',
        hablandoPorVoz ? 'cinta-chip-voz' : '',
        objetivo ? 'cinta-chip-objetivo' : ''
      ].filter(Boolean).join(' ')}
      style={{ '--cinta-color-jugador': colorDeJugador(id) }}
      aria-label={partes.join(', ')}
      onClick={objetivo ? () => onSeleccionar(id) : undefined}
      // Cuando el chip es objetivo de un poder debe poder usarse con teclado:
      // sin tabIndex/onKeyDown, role="button" es una promesa que el div no
      // cumple. Fuera de ese caso el chip NO es pulsable: los asientos llevaban
      // `pointer-events: none` salvo en `.targetable` y ese par es hoy el único
      // camino por el que las cinco rutas de poderes llegan a su manejador. Un
      // clic permanente aquí competiría con ellas sin que ningún test lo note.
      role={objetivo ? 'button' : 'group'}
      tabIndex={objetivo ? 0 : undefined}
      onKeyDown={objetivo ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSeleccionar(id);
        }
      } : undefined}
    >
      {/* El canto izquierdo ES el reloj: no es un artefacto aparte, es el borde
          de la persona a la que le toca. */}
      <span className="cinta-reloj" aria-hidden="true">
        {activo && finMs != null && <span className="cinta-reloj-drenaje" ref={refDrenaje} />}
      </span>

      <span className="cinta-cara">
        {stream
          ? <VideoDeChip stream={stream} />
          : (
            <span className="cinta-avatar" aria-hidden="true">
              {esBot ? <Bot size={13} /> : iniciales(nombre)}
            </span>
          )}
        {esLider && <Crown size={10} className="cinta-corona" aria-hidden="true" />}
        {escudo && <Shield size={10} className="cinta-escudo" aria-hidden="true" />}
        {/* DOS CANALES, NUNCA SÓLO COLOR: quien habla se marca con el anillo
            verde del chip (`cinta-chip-voz`) Y con el glifo del micro
            cambiando a un medidor de tres barras. Con el anillo solo, un
            daltónico y una captura en blanco y negro se quedan sin la señal. */}
        {enVoz && !stream && (
          hablandoPorVoz
            ? (
              <span className="linea-barras-grafico linea-barras-mesa" aria-hidden="true">
                <i className="viva" /><i className="viva" /><i className="viva" />
              </span>
            )
            : <Mic size={10} className="cinta-micro" aria-hidden="true" />
        )}
        {habla && <MessageSquare size={10} className="cinta-habla" aria-hidden="true" />}
      </span>

      <span className="cinta-datos">
        <span className="cinta-nombre">
          {nombre}
          {(equipo === 0 || equipo === 1) && (
            <span className="cinta-glifo-equipo" aria-hidden="true">{GLIFO_EQUIPO[equipo]}</span>
          )}
        </span>

        <span className="cinta-fichas" aria-hidden="true">
          {SILUETAS_FICHA.slice(0, Math.min(fichas, MAX_SILUETAS))}
          <b className="cinta-cuenta">{fichas}</b>
          {mostrarPoderes && poderes > 0 && (
            <span className="cinta-poderes"><Zap size={8} />{poderes}</span>
          )}
          {blitzSegundos !== undefined && (
            <span className={`cinta-blitz ${blitzSegundos <= 10 ? 'cinta-blitz-critico' : ''}`}>
              <Zap size={8} />{blitzSegundos}
            </span>
          )}
        </span>

        {/* Sobre qué números ha pasado. Es información pública de derecho: en una
            mesa real todos la ven, y hasta ahora solo la tenía el bot. Si el
            servidor no la manda, la fila no se pinta. */}
        {fallos.length > 0 && (
          <span
            className="cinta-fallos"
            aria-hidden="true"
            title={t('a11y.chipFallos', { nums: fallos.join(', ') })}
          >
            {fallos.slice(0, MAX_FALLOS).map(n => (
              <span key={n} className="cinta-fallo">{n}</span>
            ))}
            {fallos.length > MAX_FALLOS && (
              <span className="cinta-fallo-mas">+{fallos.length - MAX_FALLOS}</span>
            )}
          </span>
        )}

        {muescas > 0 && (
          <span className="cinta-nivel" aria-hidden="true">
            {[1, 2, 3, 4].map(i => (
              <i key={i} className={i <= muescas ? 'cinta-muesca-viva' : ''} />
            ))}
          </span>
        )}
      </span>

      {activo && finMs != null && <NumeralReloj finMs={finMs} />}

      {objetivo && <span className="cinta-objetivo" aria-hidden="true">🎯</span>}
    </div>
  );
});

export default function CintaTurno({
  players = [],
  playerId,
  currentPlayerId,
  teamsEnabled = false,
  powersEnabled = false,
  pendingTargetType = null,
  onSelectPlayerTarget,
  quickNotifications = [],
  blitzTimeRemaining,
  turnEndsAt,
  turnSecondsRemaining,
  turnDurationSeconds,
  playerPassedOn,
  esEspectador = false
}) {
  const { t } = useT();
  const voz = useVoice();
  const videosRemotos = voz ? voz.remoteVideos : {};
  // `speaking` apunta a `hablandoEnMesa`, indexado por ALIAS de asiento — que es
  // exactamente lo que vale `player.id` dentro de una sala. El otro diccionario
  // (`hablandoEnLinea`) va por id de CUENTA y es de la cápsula y de la hoja: los
  // dos eventos caían antes en el mismo objeto y mezclaban dos espacios de
  // nombres en un solo índice.
  const vozActiva = voz ? voz.speaking : {};
  // Quién está en la voz de la mesa, aliasado por el servidor. `player.inVoice`
  // era constante false desde que nadie emitía `voice_join`, así que el micro de
  // la cinta no se encendía JAMÁS.
  const enLaVoz = voz && voz.vozDeMesa ? (voz.vozDeMesa.alias || []) : [];

  const lista = useMemo(
    () => (Array.isArray(players) ? players.filter(Boolean) : []),
    [players]
  );

  // Orden de juego empezando por MÍ. Se ROTA la lista, no se reordena: así el
  // sentido de la mesa (quién juega después de quién) se sigue leyendo de
  // izquierda a derecha. El espectador no tiene chip propio, así que ve la mesa
  // en el orden en el que reparte el servidor.
  const orden = useMemo(() => {
    if (esEspectador) return lista;
    const yo = lista.findIndex(p => p.id === playerId);
    return yo <= 0 ? lista : lista.slice(yo).concat(lista.slice(0, yo));
  }, [lista, playerId, esEspectador]);

  const esMiTurno = !esEspectador && currentPlayerId != null && currentPlayerId === playerId;

  // Vencimiento del turno. `turnEndsAt` es la marca absoluta que manda el
  // servidor hoy; `turnSecondsRemaining` es el respaldo y solo se convierte a
  // marca cuando cambia, nunca en cada render, o la meta se movería a cada tic.
  const finMs = useMemo(() => {
    if (Number.isFinite(turnEndsAt)) return turnEndsAt;
    if (Number.isFinite(turnSecondsRemaining)) return Date.now() + turnSecondsRemaining * 1000;
    return null;
  }, [turnEndsAt, turnSecondsRemaining]);

  const duracionMs = Number.isFinite(turnDurationSeconds) && turnDurationSeconds > 0
    ? turnDurationSeconds * 1000
    : null;

  const [tramo, setTramo] = useState('ok');
  const [aviso, setAviso] = useState(null);

  // La escalada de color y las dos alertas ocurren SOLO en mi turno: el reloj de
  // un rival es un drenaje silencioso en su chip, no una cuenta atrás que me
  // interrumpa cada vez que a alguien se le acaba el tiempo.
  useEffect(() => {
    setTramo('ok');
    setAviso(null);
    if (!esMiTurno || finMs == null) return undefined;

    const aplicar = (umbral) => {
      setTramo(umbral.tramo);
      setAviso(umbral.clave);
      if (umbral.vibra) vibrarAviso();
    };

    const restanteMs = finMs - Date.now();
    const temporizadores = [];
    let yaPasado = null;
    for (const umbral of UMBRALES_RELOJ) {
      const espera = restanteMs - umbral.segundos * 1000;
      if (espera > 0) temporizadores.push(setTimeout(() => aplicar(umbral), espera));
      // Al reconectar, el turno puede empezar ya por debajo del umbral. Se
      // anuncia solo el más urgente de los pasados: los umbrales están en orden
      // descendente, así que gana el último.
      else yaPasado = umbral;
    }
    if (yaPasado) aplicar(yaPasado);

    return () => temporizadores.forEach(clearTimeout);
  }, [esMiTurno, finMs]);

  const objetivable = !esEspectador
    && (pendingTargetType === 'player_target' || pendingTargetType === 'smuggle_select_player');

  // Líder del marcador, con el mismo criterio que llevaban los asientos.
  const puntuacionMaxima = lista.reduce((m, p) => Math.max(m, p.score || 0), 0);
  const idLider = puntuacionMaxima > 0
    ? (lista.find(p => p.score === puntuacionMaxima) || {}).id
    : null;

  // Sobre qué números ha pasado cada uno, ya ordenado y sin repetir: el
  // servidor apunta un pase por cada extremo abierto, así que un mismo número
  // puede llegar dos veces. Se calcula aquí y no dentro del chip para que la
  // lista mantenga su identidad entre renders y el React.memo sirva de algo.
  const fallosPorJugador = useMemo(() => {
    const mapa = {};
    for (const id of Object.keys(playerPassedOn || {})) {
      const pases = playerPassedOn[id];
      if (Array.isArray(pases) && pases.length) {
        mapa[id] = [...new Set(pases)].sort((a, b) => a - b);
      }
    }
    return mapa;
  }, [playerPassedOn]);

  const activo = lista.find(p => p.id === currentPlayerId) || null;

  // Región viva del turno. El texto solo depende de QUIÉN juega, así que los
  // renders que dispara el reloj o el contador de fichas dejan el nodo idéntico
  // y el lector no repite nada.
  let textoTurno = '';
  if (activo) {
    textoTurno = esMiTurno ? t('game.turn') : `${activo.name}, ${t('a11y.chipActivo')}`;
  }

  if (orden.length === 0) return null;

  return (
    <div
      className={[
        'cinta',
        esEspectador ? 'cinta-espectador' : '',
        tramo === 'ok' ? '' : `cinta-tramo-${tramo}`
      ].filter(Boolean).join(' ')}
      data-chips={orden.length}
    >
      <p className="cinta-estado sr-only" role="status">{textoTurno}</p>

      {/* Las dos alertas del reloj. Se sustituye el nodo entero al pasar de 10 s
          a 5 s (de ahí la `key`): reemplazarlo es lo que más fiablemente hace
          que un lector relea una región assertive. */}
      {aviso && (
        <p key={aviso} className="cinta-aviso sr-only" role="alert">{t(aviso)}</p>
      )}

      {orden.map((jugador) => {
        // Quién acaba de hablar. El texto ya sale como toast en GameView, así
        // que aquí solo hace falta la marca que lo ata a una persona.
        const habla = (quickNotifications || []).some(
          (n) => n.playerId === jugador.id || n.playerName === jugador.name
        );

        return (
          <Chip
            key={jugador.id}
            id={jugador.id}
            nombre={jugador.name}
            esBot={!!jugador.isBot}
            nivel={jugador.difficulty}
            equipo={teamsEnabled ? jugador.team : undefined}
            activo={jugador.id === currentPlayerId}
            esYo={!esEspectador && jugador.id === playerId}
            habla={habla}
            hablandoPorVoz={!!vozActiva[jugador.id]}
            stream={jugador.camOn ? videosRemotos[jugador.id] || null : null}
            escudo={!!jugador.shieldActive}
            enVoz={enLaVoz.includes(jugador.id)}
            fichas={jugador.handCount || 0}
            poderes={jugador.powersCount || 0}
            mostrarPoderes={!!powersEnabled}
            fallos={fallosPorJugador[jugador.id] || SIN_FALLOS}
            esLider={jugador.id === idLider}
            blitzSegundos={blitzTimeRemaining ? blitzTimeRemaining[jugador.id] : undefined}
            // Nadie se apunta a sí mismo: los asientos solo dibujaban rivales,
            // así que hacer objetivo el chip propio sería una ruta de poder
            // nueva, no la misma de antes.
            objetivo={objetivable && jugador.id !== playerId}
            finMs={finMs}
            duracionMs={duracionMs}
            onSeleccionar={onSelectPlayerTarget}
          />
        );
      })}
    </div>
  );
}
