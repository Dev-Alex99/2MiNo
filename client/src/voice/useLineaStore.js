/**
 * El motor de la línea: el estado de la voz y lo único que lo escribe.
 *
 * Aquí se juntan las tres piezas puras —`maquina` (qué estado), `calidad` (cómo
 * va cada par) y `mediosLocales` (micro, cámara, VAD)— con la malla de
 * RTCPeerConnection y el socket. Es lo que antes eran 707 líneas de hook, menos
 * las mentiras.
 *
 * DOS REGLAS DE ESTE ARCHIVO, las dos con su cicatriz:
 *
 * · LOS `socket.on()` VAN DENTRO DE `iniciar()`, NUNCA EN ÁMBITO DE MÓDULO. El
 *   banco de pruebas hace `handlers.clear()` en cada `afterEach`: unos listeners
 *   registrados al importar sobreviven UN test por fichero y después no se
 *   vuelven a registrar nunca — y todas las pruebas posteriores pasan en verde
 *   sin escuchar nada. `iniciar()` es idempotente y se puede volver a llamar.
 *
 * · `voice_hello` NO SE EMITE AQUÍ. Lo emite `useGameSocket` justo detrás de
 *   cada `hello`, porque el saludo de voz y el handshake de identidad son el
 *   mismo suceso y separarlos deja el reenganche a merced del orden. Emitirlo
 *   también desde el motor mandaría dos por reconexión.
 */

import { create } from 'zustand';
import { serverUrl } from '../socket';
import { lineaInicial, reducir, EN_LLAMADA, CON_MICRO } from './maquina';
import { crearMalla } from './malla';
import { crearMediosLocales, CAN_PICK_SPEAKER, recall } from './mediosLocales';
import {
  TIMBRE_LOCAL, RECUPERANDO_TOPE, CERRADA_VISIBLE, MUESTREO_CALIDAD
} from './tiempos';

const STUN_DE_RESPALDO = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const ESTADO_INICIAL = {
  ...lineaInicial(),

  /** cuentaId -> uno de los ocho estados de calidad.js. Es MI mitad de la ruta. */
  pares: {},
  /**
   * La mitad del otro, tal y como él la cuenta por `voice_peer_state`. La clave
   * es `'quienLoDice>sobreQuien'`: cada extremo sólo ve su lado, y con las dos
   * mitades la hoja puede decir «Luis · sin ruta» en vez de dejar a los dos
   * adivinando por qué no se oyen.
   */
  paresRemotos: {},
  /** Quién habla EN LA LÍNEA, indexado por id de CUENTA. */
  hablandoEnLinea: {},
  /** Quién habla EN LA MESA, indexado por ALIAS de asiento. Son dos diccionarios
   *  distintos a propósito: antes los dos eventos caían en el mismo objeto y
   *  mezclaban dos espacios de nombres en un solo índice. */
  hablandoEnMesa: {},
  /**
   * La voz de la mesa vista desde fuera: de QUÉ sala, quién está y cuántos son.
   * `n` cuenta a toda la línea (también a los amigos no sentados); `alias`, sólo
   * a los que tienen asiento. El `roomId` viaja porque los alias se acuñan POR
   * SALA: sin él no hay forma de saber que el diccionario ha caducado.
   */
  vozDeMesa: { roomId: null, alias: [], n: 0 },

  muted: false,
  isDeafened: false,
  camOn: false,
  camBusy: false,
  localVideo: null,
  remoteVideos: {},

  dispositivos: { mics: [], cams: [], speakers: [] },
  seleccionados: { mic: '', cam: '', speaker: '' },
  cambiando: false,
  /** { motivo, clave } — la clave es i18n, no texto: quien pinta es quien traduce. */
  micError: null,

  /**
   * Medidor de entrada: 0..7 segmentos y su equivalente hablado, estable.
   * `nivelPalabra` es una CLAVE i18n completa, como `micError.clave` y como las
   * de la crónica: quien lo pinte hace `t(nivelPalabra)` y no compone prefijos.
   */
  nivel: 0,
  nivelPalabra: 'linea.nivelSinSenal',

  /**
   * Modo de retransmisión, tal y como lo anuncia /ice-config. CADENA
   * ('cloudflare' | 'custom' | 'free-fallback' | 'none'), nunca un booleano: el
   * servidor pone turnMode='free-fallback' con TRES URLs de openrelay reales
   * mientras `turnConfigured` sigue en false, así que ramificar por el booleano
   * sería mentir en la dirección contraria.
   */
  relevo: 'free-fallback',

  /** Cola para la crónica: { id, key, params }. La drena GameView. */
  avisos: []
};

export const useLineaStore = create(() => ({ ...ESTADO_INICIAL }));

const set = useLineaStore.setState;
const get = useLineaStore.getState;

/* ───────────────────────────────────────────────── el motor, fuera de React */

const motor = {
  activo: false,
  socket: null,
  cuentaId: '',
  medios: null,
  malla: null,
  ice: null,
  relojes: { estado: null, muestreo: null },
  manejadores: null,
  contadorAviso: 0,
  /** «Entrar solo a escuchar»: la malla se monta sin pista propia. */
  soloEscucha: false
};

function avisar(key, params) {
  motor.contadorAviso += 1;
  const aviso = { id: `av_${motor.contadorAviso}`, key, params: params || null };
  // La cola se acota: la crónica es un registro de lo que acaba de pasar, no un
  // historial. Sin tope, una tormenta de reconexiones la llena sin fin.
  set(s => ({ avisos: [...s.avisos, aviso].slice(-20) }));
}

async function cargarIce() {
  if (motor.ice) return motor.ice;
  try {
    // `/api/turn-credentials` NO EXISTE en el servidor. En desarrollo esa ruta
    // relativa la servía Vite, que devuelve el index.html con 200 OK, así que
    // `res.ok` era true y `res.json()` reventaba con '<' — y lo tragaba el
    // catch. Resultado: la voz corría SIEMPRE con un único STUN. `serverUrl` lo
    // exporta socket.js justo para esto (su comentario dice «/ice-config»).
    const res = await fetch(`${serverUrl}/ice-config`);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.iceServers)) {
        motor.ice = { iceServers: data.iceServers };
        if (data.turnMode) set({ relevo: data.turnMode });
        return motor.ice;
      }
    }
  } catch { /* sin configuración: se sigue con el STUN público */ }
  motor.ice = STUN_DE_RESPALDO;
  return motor.ice;
}

/* ─────────────────────────────────────────────────────────── relojes */

function pararRelojEstado() {
  if (motor.relojes.estado) { clearTimeout(motor.relojes.estado); motor.relojes.estado = null; }
}

/**
 * Un solo temporizador, el que corresponda al estado actual. Tenerlos sueltos
 * es lo que producía la tarjeta «Llamando…» eterna: cuando el servidor devolvía
 * `call_error` y retornaba antes de crear la llamada, no había ningún plazo
 * armado en ninguna parte.
 */
function armarReloj(linea) {
  pararRelojEstado();
  const despues = (ms, suceso) => {
    motor.relojes.estado = setTimeout(() => { motor.relojes.estado = null; despachar(suceso); }, Math.max(0, ms));
  };
  switch (linea.estado) {
    case 'saliente':
      despues(TIMBRE_LOCAL, { tipo: 'timbreLocalTope' });
      break;
    case 'entrante': {
      const restante = linea.entrante && linea.entrante.expiraEn
        ? linea.entrante.expiraEn - Date.now()
        : TIMBRE_LOCAL;
      despues(restante, { tipo: 'expiraEntrante' });
      break;
    }
    case 'recuperando':
      despues(RECUPERANDO_TOPE, { tipo: 'recuperandoTope' });
      break;
    case 'cerrada':
      despues(CERRADA_VISIBLE, { tipo: 'cerradaVista' });
      break;
    default:
      break;
  }
}

function pararMuestreo() {
  if (motor.relojes.muestreo) { clearInterval(motor.relojes.muestreo); motor.relojes.muestreo = null; }
}

function ajustarMuestreo(linea) {
  const toca = EN_LLAMADA.includes(linea.estado);
  if (toca && !motor.relojes.muestreo) {
    motor.relojes.muestreo = setInterval(() => {
      if (!motor.malla) return;
      motor.malla.muestrear().then(() => {
        despachar({ tipo: 'pares', pares: get().pares });
      }).catch(() => { /* un ciclo perdido no es un fallo */ });
    }, MUESTREO_CALIDAD);
  } else if (!toca && motor.relojes.muestreo) {
    pararMuestreo();
  }
}

/* ────────────────────────────────────────────────── despacho y efectos */

/** Los campos del estado que gobierna la máquina pura. */
const CAMPOS_MAQUINA = Object.keys(lineaInicial());

function lineaDeAhora() {
  const s = get();
  const linea = {};
  for (const k of CAMPOS_MAQUINA) linea[k] = s[k];
  return linea;
}

export function despachar(suceso) {
  // Con el motor parado no se despacha NADA: los efectos emiten por un socket
  // que ya se ha soltado. Un temporizador que vence justo después de `detener()`
  // llegaría aquí, y el `motor.socket.emit` de más abajo reventaría.
  if (!motor.activo) return;
  const antes = lineaDeAhora();
  const { linea, efectos } = reducir(antes, { ahora: Date.now(), ...suceso });

  const cambioDeEstado = linea.estado !== antes.estado;
  if (linea !== antes) set(linea);

  for (const efecto of efectos) {
    if (efecto.tipo === 'emitir') motor.socket.emit(efecto.evento, efecto.payload);
    else if (efecto.tipo === 'aviso') avisar(efecto.key, efecto.params);
    else if (efecto.tipo === 'pedirMicro') pedirMicro();
    else if (efecto.tipo === 'reiniciarIce' && motor.malla) motor.malla.reiniciarIce();
  }

  if (cambioDeEstado || linea.miembros !== antes.miembros) sincronizarMalla(linea, antes);
  if (cambioDeEstado) { armarReloj(linea); ajustarMuestreo(linea); }
  return linea;
}

async function pedirMicro() {
  try {
    await motor.medios.pedirMicro();
    set({ micError: null });
    despachar({ tipo: 'microListo' });
  } catch (e) {
    set({ micError: { motivo: e.motivo || 'micro_desconocido', clave: e.clave || 'voice.errGenericMic' } });
    despachar({ tipo: 'microFallo', motivo: e.motivo || 'micro_desconocido' });
  }
}

/**
 * La malla sigue a la pertenencia, y la pertenencia la dice el servidor.
 *
 * En `recuperando` NO se toca nada: una `pc` no muere porque muera el socket de
 * señalización, y cerrarla ahí convertiría un bache de red de tres segundos en
 * una llamada perdida.
 */
function sincronizarMalla(linea, antes) {
  if (!motor.malla) return;
  if (linea.estado === 'recuperando') return;

  if (!EN_LLAMADA.includes(linea.estado)) {
    if (EN_LLAMADA.includes(antes.estado) || motor.malla.cuantos() > 0) {
      motor.malla.destruirTodo();
      set({ pares: {}, paresRemotos: {}, remoteVideos: {}, hablandoEnLinea: {} });
    }
    // Colgar suelta el micro y PARA EL DETECTOR. Antes no lo hacía nadie: tras
    // cada llamada quedaba un bucle a 60 fps sobre un analizador alimentado por
    // pistas paradas y un AudioContext abierto, hasta cerrar la pestaña.
    if (!CON_MICRO.includes(linea.estado) && linea.estado !== 'pidiendoMicro') {
      motor.medios.soltar();
      motor.soloEscucha = false;
      set({ camOn: false, localVideo: null, muted: false, isDeafened: false });
    }
    return;
  }

  motor.malla.sincronizar(linea.miembros).catch(e => {
    // Lo único que puede fallar aquí es el micrófono, y eso aborta la llamada
    // con su motivo. Un par mudo es peor que una llamada que no se establece.
    if (e && e.motivo) {
      set({ micError: { motivo: e.motivo, clave: e.clave || 'voice.errGenericMic' } });
      despachar({ tipo: 'microFallo', motivo: e.motivo });
    }
  });
}

/* ─────────────────────────────────────────────────────── el ciclo de vida */

function construirManejadores() {
  const socket = motor.socket;

  const h = {
    // OJO CON EL ORDEN: `tipo` va SIEMPRE DESPUÉS del `...d`. El payload de
    // `incoming_call` trae su propio `tipo` ('directa'|'grupo'|'mesa') y, puesto
    // delante, machacaba el discriminante del suceso: la máquina recibía un
    // suceso llamado 'directa', no lo reconocía y el timbre no sonaba jamás.
    // Por eso `clase` se llama `clase` dentro de la máquina.
    voice_state: (d = {}) => despachar({ ...d, tipo: 'voice_state' }),
    voice_taken: (d = {}) => despachar({ tipo: 'voice_taken', callId: d.callId || null }),

    incoming_call: (d = {}) => despachar({ ...d, clase: d.tipo, tipo: 'incoming_call' }),
    call_outgoing: (d = {}) => despachar({ ...d, tipo: 'call_outgoing' }),
    call_accepted: (d = {}) => despachar({ ...d, tipo: 'call_accepted' }),
    call_declined: (d = {}) => despachar({ ...d, tipo: 'call_declined' }),
    call_timeout: (d = {}) => despachar({ ...d, tipo: 'call_timeout' }),
    call_cancelled: (d = {}) => despachar({ ...d, tipo: 'call_cancelled' }),
    call_error: (d = {}) => despachar({ ...d, tipo: 'call_error' }),

    voice_pool_joined: (d = {}) => despachar({
      tipo: 'voice_pool_joined',
      poolId: d.poolId, contexto: d.contexto,
      // `members` es el nombre legado que P4-SRV mantiene durante la ventana de
      // tolerancia; `miembros` es el del contrato. Se leen los dos y gana el
      // nuevo, así que el día que el servidor retire el legado no pasa nada.
      miembros: d.miembros || d.members || []
    }),
    voice_pool_updated: (d = {}) => despachar({
      tipo: 'voice_pool_updated',
      poolId: d.poolId, contexto: d.contexto,
      miembros: d.miembros || d.members || []
    }),
    voice_pool_left: (d = {}) => despachar({ ...d, tipo: 'voice_pool_left' }),

    voice_pool_signal: (d = {}) => {
      if (motor.malla) motor.malla.senal(d.fromPlayerId, d.signal);
    },

    voice_pool_speaking: (d = {}) => {
      if (!d.playerId) return;
      const actual = get().hablandoEnLinea;
      if (actual[d.playerId] === !!d.speaking) return;
      set({ hablandoEnLinea: { ...actual, [d.playerId]: !!d.speaking } });
    },

    // El diagnóstico del OTRO extremo sobre mí y sobre los demás. Cada lado sólo
    // ve su mitad de la ruta; esto es lo que permite decir «Luis · sin ruta» en
    // vez de dejar a los dos adivinando.
    voice_peer_state: (d = {}) => {
      if (!d.playerId || !d.peerPlayerId || !d.estado) return;
      set(s => ({ paresRemotos: { ...s.paresRemotos, [`${d.playerId}>${d.peerPlayerId}`]: d.estado } }));
    },

    // EL ALIAS ES POR SALA. `seatAliases` lo acuña con el roomId, así que dos
    // mesas distintas pueden repartir el mismo 's_abc'. Al cambiar de mesa hay
    // que tirar el diccionario anterior: si no, un anillo de «está hablando»
    // podría encenderse sobre el asiento equivocado de la mesa siguiente, sin
    // error, sin forma de apagarlo y sin nada que lo delate.
    table_voice: (d = {}) => {
      const previa = get().vozDeMesa.roomId;
      const cambioDeMesa = !!d.roomId && !!previa && d.roomId !== previa;
      set({
        vozDeMesa: { roomId: d.roomId || null, alias: d.alias || [], n: d.n || 0 },
        ...(cambioDeMesa ? { hablandoEnMesa: {} } : null)
      });
    },

    // OJO: `alias` viaja como ARRAY con UN elemento. Todo lo que va a una sala
    // pasa por `emitirAMesa()`, que produce un array (lo reportó P4-SRV).
    table_speaking: (d = {}) => {
      const alias = Array.isArray(d.alias) ? d.alias[0] : d.alias;
      if (!alias) return;
      const mesa = get().vozDeMesa;
      if (d.roomId && mesa.roomId && d.roomId !== mesa.roomId) return;
      const actual = get().hablandoEnMesa;
      if (actual[alias] === !!d.speaking) return;
      set({ hablandoEnMesa: { ...actual, [alias]: !!d.speaking } });
    }
  };

  for (const [evento, fn] of Object.entries(h)) socket.on(evento, fn);
  return h;
}

/** El atajo global de silenciar. Silenciarse rápido es la acción más urgente
 *  que existe en una llamada, y hoy exige acertar en un botón de 30×30. */
function alPulsarTecla(e) {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
  if ((e.key || '').toLowerCase() !== 'm') return;
  const foco = document.activeElement;
  const etiqueta = foco ? (foco.tagName || '').toLowerCase() : '';
  if (etiqueta === 'input' || etiqueta === 'textarea' || (foco && foco.isContentEditable)) return;
  if (!motor.medios || !motor.medios.hayMicro()) return;
  e.preventDefault();
  acciones.alternarSilencio();
}

/**
 * Arranca el motor. IDEMPOTENTE: llamarlo dos veces no duplica listeners.
 */
export function iniciar({ socket, cuentaId }) {
  if (motor.activo) {
    // Cambiar de identidad con una llamada viva no tiene sentido y sí tiene
    // consecuencias (el desempate de `polite` deja de ser complementario), así
    // que se reinicia el motor entero.
    if (motor.cuentaId === cuentaId && motor.socket === socket) return;
    detener();
  }
  motor.activo = true;
  motor.socket = socket;
  motor.cuentaId = cuentaId;

  motor.medios = crearMediosLocales({
    alHablar: (hablando) => {
      set(s => ({ hablandoEnLinea: { ...s.hablandoEnLinea, [motor.cuentaId]: hablando } }));
      if (get().poolId) socket.emit('voice_pool_speaking', { speaking: hablando });
    },
    alNivel: (segmentos, palabra) => set({ nivel: segmentos, nivelPalabra: palabra }),
    alDispositivos: (lista) => set({ dispositivos: lista }),
    alVideo: (stream) => set({ localVideo: stream, camOn: !!stream })
  });

  motor.malla = crearMalla({
    socket,
    cuentaId,
    obtenerIce: cargarIce,
    obtenerStream: () => (motor.soloEscucha ? Promise.resolve(null) : motor.medios.pedirMicro()),
    pistaDeVideo: () => motor.medios.pistaDeVideo(),
    hayPool: () => !!get().poolId,
    alPar: (id, estado) => {
      set(s => {
        const pares = { ...s.pares };
        if (estado !== 'ido') return { pares: { ...pares, [id]: estado } };
        delete pares[id];
        // Quien se va JUSTO mientras hablaba dejaba su punto verde encendido
        // para siempre: `destroyPoolPeer` no limpiaba `speaking`. Se apaga aquí,
        // que es el único sitio por el que se sale de la malla.
        const hablandoEnLinea = { ...s.hablandoEnLinea };
        delete hablandoEnLinea[id];
        return { pares, hablandoEnLinea };
      });
      // Un ICE que falla tiene que llegar a la pantalla YA, no en el siguiente
      // ciclo de muestreo: sin TURN es el caso esperado, no la excepción rara.
      despachar({ tipo: 'pares', pares: get().pares });
    },
    alVideoRemoto: (id, stream) => set(s => {
      const remoteVideos = { ...s.remoteVideos };
      if (stream) remoteVideos[id] = stream; else delete remoteVideos[id];
      return { remoteVideos };
    }),
    estaEnsordecido: () => get().isDeafened,
    altavoz: () => motor.medios.altavozActual()
  });

  set({
    ...ESTADO_INICIAL,
    seleccionados: { mic: recall('mic'), cam: recall('cam'), speaker: recall('speaker') }
  });

  motor.manejadores = construirManejadores();
  motor.medios.escucharAparatos();
  motor.medios.refrescarDispositivos();
  if (typeof window !== 'undefined') window.addEventListener('keydown', alPulsarTecla);
}

/**
 * Desmontaje COMPLETO, que hasta ahora no existía: pares destruidos, `<audio>`
 * retirados del body, pistas paradas, detector parado y listeners fuera. El
 * único cleanup del hook viejo cerraba el AudioContext y nada más — y sólo
 * corría al cerrar la pestaña, porque el proveedor vive en la raíz.
 */
export function detener() {
  if (!motor.activo) return;
  motor.activo = false;
  pararRelojEstado();
  pararMuestreo();
  if (motor.manejadores && motor.socket) {
    for (const [evento, fn] of Object.entries(motor.manejadores)) motor.socket.off(evento, fn);
  }
  if (typeof window !== 'undefined') window.removeEventListener('keydown', alPulsarTecla);
  if (motor.malla) motor.malla.desmontar();
  if (motor.medios) { motor.medios.dejarDeEscucharAparatos(); motor.medios.soltar(); }
  motor.manejadores = null;
  motor.malla = null;
  motor.medios = null;
  motor.socket = null;
  motor.cuentaId = '';
  motor.ice = null;
  motor.soloEscucha = false;
  set({ ...ESTADO_INICIAL });
}

/* ─────────────────────────────────────────────────────────── acciones */

export const acciones = {
  /** Llamar a una persona por su id de CUENTA. */
  llamar(a, nombre) { despachar({ tipo: 'llamar', a, nombre }); },
  aceptar() { despachar({ tipo: 'aceptar' }); },
  rechazar() { despachar({ tipo: 'rechazar' }); },
  cancelar() { despachar({ tipo: 'cancelar' }); },
  colgar() { despachar({ tipo: 'colgar' }); },
  invitar(a) { despachar({ tipo: 'invitar', a }); },
  entrarAMesa() { despachar({ tipo: 'entrarAMesa' }); },
  cambiarALaMesa() { despachar({ tipo: 'cambiarALaMesa' }); },
  reintentar() { despachar({ tipo: 'reintentar' }); },

  /**
   * El botón de la tarjeta de error del micrófono. NO es un modo al que se
   * llegue solo: es el único sitio del producto donde existe solo-escucha, y se
   * llega pulsándolo con el motivo del fallo delante.
   */
  soloEscuchar() {
    motor.soloEscucha = true;
    despachar({ tipo: 'soloEscuchar' });
  },

  alternarSilencio() {
    if (!motor.medios) return;
    const siguiente = motor.medios.silenciar(!get().muted);
    if (motor.malla) motor.malla.aplicarSilencio(siguiente);
    set({ muted: siguiente });
  },

  alternarEnsordecido() {
    const siguiente = !get().isDeafened;
    if (motor.malla) motor.malla.aplicarEnsordecido(siguiente);
    set({ isDeafened: siguiente });
  },

  async alternarCamara() {
    if (!motor.medios || get().camBusy) return;
    set({ camBusy: true });
    try {
      if (get().camOn) {
        if (motor.malla) motor.malla.quitarVideo();
        motor.medios.apagarCamara();
      } else {
        const stream = await motor.medios.encenderCamara();
        const pista = stream.getVideoTracks()[0];
        if (pista && motor.malla) motor.malla.anadirVideo(pista, stream);
      }
      set({ micError: null });
    } catch (e) {
      // La cámara falla igual que el micro y con las mismas claves: hasta ahora
      // `toggleCam` se tragaba el error con un console.warn y no pasaba nada.
      set({ micError: { motivo: e.motivo || 'micro_desconocido', clave: e.clave || 'voice.errGenericCam' } });
    } finally {
      set({ camBusy: false });
    }
  },

  async elegirMicro(deviceId) {
    set(s => ({ seleccionados: { ...s.seleccionados, mic: deviceId }, cambiando: true }));
    try {
      const pista = await motor.medios.elegirMicro(deviceId);
      if (pista && motor.malla) motor.malla.reemplazarAudio(pista);
      set({ micError: null });
    } catch (e) {
      set({ micError: { motivo: e.motivo || 'micro_desconocido', clave: e.clave || 'voice.errMicSwitch' } });
    } finally {
      set({ cambiando: false });
    }
  },

  async elegirCamara(deviceId) {
    set(s => ({ seleccionados: { ...s.seleccionados, cam: deviceId }, cambiando: true }));
    try {
      const pista = await motor.medios.elegirCamara(deviceId);
      if (pista && motor.malla) motor.malla.reemplazarVideo(pista);
    } catch (e) {
      set({ micError: { motivo: e.motivo || 'micro_desconocido', clave: e.clave || 'voice.errCamSwitch' } });
    } finally {
      set({ cambiando: false });
    }
  },

  elegirAltavoz(deviceId) {
    if (!motor.medios) return;
    motor.medios.elegirAltavoz(deviceId);
    if (motor.malla) motor.malla.aplicarAltavoz(deviceId);
    set(s => ({ seleccionados: { ...s.seleccionados, speaker: deviceId } }));
  },

  /** La crónica de GameView drena la cola por aquí. */
  descartarAviso(id) { set(s => ({ avisos: s.avisos.filter(a => a.id !== id) })); },
  vaciarAvisos() { set({ avisos: [] }); },

  canPickSpeaker: CAN_PICK_SPEAKER
};
