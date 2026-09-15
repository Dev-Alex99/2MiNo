import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createFakeSocket } from './fakeSocket';

// Un único doble de socket para toda la suite. Se expone en globalThis para que
// el factory del mock (que se evalúa perezosamente) pueda alcanzarlo sin caer en
// la zona muerta temporal del hoisting de `vi.mock`.
globalThis.__socket = createFakeSocket();

vi.mock('../socket', () => ({
  socket: globalThis.__socket,
  serverUrl: 'http://test.local'
}));

// jsdom no implementa varias APIs de navegador que la app usa al montar. Sin
// estos dobles, cualquier render revienta por motivos que no son el fallo que
// se quiere detectar.
//
// Los de voz van más allá de "que no reviente": llevan una superficie de control
// con prefijo `__` para poder PROVOCAR lo que hay que probar —un ICE que falla,
// un micro ocupado, unos auriculares enchufados a media llamada, un contexto de
// audio que nace suspendido—. Un doble que sólo devuelve promesas resueltas deja
// cualquier prueba de voz en verde sin haber comprobado nada.
//
// LOS MANDOS, todos en globalThis y todos devueltos a su estado inicial en el
// `afterEach` de este mismo archivo:
//
//   __socket             el doble de socket.io (ver fakeSocket.js)
//   __fetch              lo que responde /ice-config y qué URLs se han pedido
//   __mediaDevices       getUserMedia, la lista de aparatos y 'devicechange'
//   __audio              nivel del analizador, contextos y osciladores
//   __vibracion          navigator.vibrate (ausente por defecto)
//   RTCPeerConnection.__todas() / __ultima() / __abiertas()
//                        las conexiones que ha creado el código bajo prueba;
//                        cada una trae sus propios `__` (ver más abajo)
//
// EL TIEMPO no lleva mando propio: se avanza con las utilidades de vitest,
// `vi.useFakeTimers()` ANTES de montar y `act(() => vi.advanceTimersByTime(ms))`
// después. `Date` entra en el paquete que vitest falsea por defecto, así que
// `Date.now()` avanza con ellos —que es de lo que dependen el VAD y las cuentas
// atrás—. El `afterEach` de aquí devuelve los relojes de verdad pase lo que pase.

// useIsMobile
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  });
}

// GameBoard mide el tablero con ResizeObserver
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO — audio.js (efectos y timbre) y el detector de voz
// ─────────────────────────────────────────────────────────────────────────────

// El doble no sintetiza nada: apunta lo que se le pide. Con eso un test puede
// afirmar que el timbre sonó con su bitono, o que el medidor de nivel recibió la
// señal que dice recibir, sin un altavoz de por medio.
const CONTROL_AUDIO = {
  nacenSuspendidos: false,
  rms: 0,
  contextos: [],
  osciladores: []
};

// Un AudioParam falso: acepta toda la familia de rampas (el que falte hace que
// audio.js caiga en su catch y el sonido desaparezca sin romper ningún test) y
// puede apuntar los valores programados para quien quiera afirmarlos.
function crearParametro(valorInicial = 0, registro = null) {
  const anotar = (v) => { if (registro) registro.push(v); };
  return {
    value: valorInicial,
    setValueAtTime(v) { anotar(v); return this; },
    exponentialRampToValueAtTime(v) { anotar(v); return this; },
    linearRampToValueAtTime(v) { anotar(v); return this; },
    setTargetAtTime(v) { anotar(v); return this; },
    setValueCurveAtTime() { return this; },
    cancelScheduledValues() { return this; }
  };
}

const NODO_CONECTABLE = () => ({ connect: () => NODO_CONECTABLE(), disconnect() {} });

class AudioContextFalso {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = { connect() {}, disconnect() {} };
    // Un AudioContext creado sin gesto del usuario nace 'suspended', y una
    // llamada entrante es por definición lo contrario de un gesto: el motor
    // tiene que llamar a resume() y esto permite comprobarlo.
    this.state = CONTROL_AUDIO.nacenSuspendidos ? 'suspended' : 'running';
    this.__resumes = 0;
    this.__cerrado = false;
    CONTROL_AUDIO.contextos.push(this);
  }

  createOscillator() {
    const osc = {
      type: 'sine',
      __frecuencias: [],
      __iniciado: null,
      __parado: null,
      frequency: null,
      detune: crearParametro(0),
      connect: () => NODO_CONECTABLE(),
      disconnect() {},
      start(t = 0) { osc.__iniciado = t; },
      stop(t = 0) { osc.__parado = t; },
      onended: null
    };
    osc.frequency = crearParametro(0, osc.__frecuencias);
    CONTROL_AUDIO.osciladores.push(osc);
    return osc;
  }

  createGain() {
    return {
      connect: () => NODO_CONECTABLE(),
      disconnect() {},
      gain: crearParametro(1)
    };
  }

  createBiquadFilter() {
    return {
      type: 'lowpass',
      frequency: crearParametro(350),
      Q: crearParametro(1),
      gain: crearParametro(0),
      detune: crearParametro(0),
      connect: () => NODO_CONECTABLE(),
      disconnect() {}
    };
  }

  createBuffer(canales, largo, tasa) {
    return {
      numberOfChannels: canales,
      length: largo,
      sampleRate: tasa || this.sampleRate,
      duration: largo / (tasa || this.sampleRate),
      getChannelData: () => new Float32Array(largo)
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      loop: false,
      playbackRate: crearParametro(1),
      detune: crearParametro(0),
      connect: () => NODO_CONECTABLE(),
      disconnect() {},
      start() {},
      stop() {},
      onended: null
    };
  }

  createMediaStreamSource(stream) {
    return { mediaStream: stream, connect: () => NODO_CONECTABLE(), disconnect() {} };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      minDecibels: -100,
      maxDecibels: -30,
      get frequencyBinCount() { return this.fftSize / 2; },
      connect: () => NODO_CONECTABLE(),
      disconnect() {},
      // Onda cuadrada alrededor de 128 con la amplitud pedida: `rmsDe` de vad.js
      // divide entre 128, así que el RMS que lea es EXACTAMENTE el nivel que el
      // test pidió. Un seno daría 0,707 veces el valor y obligaría a cada test a
      // recordar el factor.
      getByteTimeDomainData(destino) {
        const amp = Math.min(127, Math.round(CONTROL_AUDIO.rms * 128));
        for (let i = 0; i < destino.length; i++) destino[i] = i % 2 === 0 ? 128 + amp : 128 - amp;
      },
      getByteFrequencyData(destino) {
        destino.fill(Math.min(255, Math.round(CONTROL_AUDIO.rms * 255)));
      },
      getFloatTimeDomainData(destino) {
        for (let i = 0; i < destino.length; i++) destino[i] = i % 2 === 0 ? CONTROL_AUDIO.rms : -CONTROL_AUDIO.rms;
      }
    };
  }

  resume() { this.__resumes += 1; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.__cerrado = true; this.state = 'closed'; return Promise.resolve(); }
}

globalThis.__audio = {
  /** Los contextos nuevos nacerán 'suspended' (el caso de la pestaña sin gesto). */
  nacerSuspendido(v = true) { CONTROL_AUDIO.nacenSuspendidos = v; },
  /** Nivel (0..1) que devolverá el analizador. `rmsDe()` leerá este mismo valor. */
  nivel(rms) { CONTROL_AUDIO.rms = rms; },
  /** Contextos creados, en orden. Cada uno lleva `__resumes` y `__cerrado`. */
  contextos() { return [...CONTROL_AUDIO.contextos]; },
  /** Osciladores creados, con `__frecuencias`, `__iniciado` y `__parado`. */
  osciladores() { return [...CONTROL_AUDIO.osciladores]; },
  reset() {
    CONTROL_AUDIO.nacenSuspendidos = false;
    CONTROL_AUDIO.rms = 0;
    CONTROL_AUDIO.contextos = [];
    CONTROL_AUDIO.osciladores = [];
  }
};

window.AudioContext = AudioContextFalso;
window.webkitAudioContext = AudioContextFalso;

// ─────────────────────────────────────────────────────────────────────────────
// VIBRACIÓN — el segundo de los tres canales del timbre
// ─────────────────────────────────────────────────────────────────────────────

// AUSENTE por defecto, igual que en jsdom hoy: `App.jsx:151` y
// `CintaTurno.jsx:64` comprueban que exista, y declararla cambiaría el camino
// que recorren tests que no tienen nada que ver con esto. Quien quiera afirmar
// que el timbre vibró la enciende y la apaga sola al acabar el caso.
const PULSOS = [];

globalThis.__vibracion = {
  activar() {
    navigator.vibrate = vi.fn((patron) => { PULSOS.push(patron); return true; });
  },
  desactivar() { delete navigator.vibrate; },
  /** Patrones pedidos, en orden. */
  pulsos() { return [...PULSOS]; },
  reset() { PULSOS.length = 0; delete navigator.vibrate; }
};

// ─────────────────────────────────────────────────────────────────────────────
// MEDIOS — pistas, streams y navigator.mediaDevices
// ─────────────────────────────────────────────────────────────────────────────

let contadorPista = 0;
let contadorStream = 0;

function crearPistaFalsa({ kind = 'audio', label = '', deviceId = 'default' } = {}) {
  return {
    kind,
    id: `${kind}_${++contadorPista}`,
    label,
    enabled: true,
    muted: false,
    readyState: 'live',
    onended: null,
    __deviceId: deviceId,
    __parada: false,
    stop() { this.__parada = true; this.readyState = 'ended'; },
    getSettings() { return { deviceId: this.__deviceId }; },
    getCapabilities() { return {}; },
    applyConstraints() { return Promise.resolve(); },
    addEventListener() {},
    removeEventListener() {},
    clone() { return crearPistaFalsa({ kind, label, deviceId }); }
  };
}

class MediaStreamFalso {
  constructor(entrada = []) {
    this.id = `ms_${++contadorStream}`;
    if (Array.isArray(entrada)) this.__pistas = [...entrada];
    else if (entrada && typeof entrada.getTracks === 'function') this.__pistas = [...entrada.getTracks()];
    else this.__pistas = [];
  }
  get active() { return this.__pistas.some(p => p.readyState === 'live'); }
  getTracks() { return [...this.__pistas]; }
  // El doble anterior devolvía [] siempre: `stream.getAudioTracks().length` era
  // cero incluso con pistas dentro, y con eso el VAD nunca arrancaba en un test.
  getAudioTracks() { return this.__pistas.filter(p => p.kind === 'audio'); }
  getVideoTracks() { return this.__pistas.filter(p => p.kind === 'video'); }
  getTrackById(id) { return this.__pistas.find(p => p.id === id) || null; }
  addTrack(p) { if (!this.__pistas.includes(p)) this.__pistas.push(p); }
  removeTrack(p) { this.__pistas = this.__pistas.filter(x => x !== p); }
  clone() { return new MediaStreamFalso(this.__pistas.map(p => p.clone())); }
  addEventListener() {}
  removeEventListener() {}
}

globalThis.MediaStream = MediaStreamFalso;

function crearStreamFalso({ audio = 1, video = 0, deviceId = 'default' } = {}) {
  const pistas = [];
  for (let i = 0; i < audio; i++) pistas.push(crearPistaFalsa({ kind: 'audio', label: 'Micro de prueba', deviceId }));
  for (let i = 0; i < video; i++) pistas.push(crearPistaFalsa({ kind: 'video', label: 'Cámara de prueba', deviceId }));
  return new MediaStreamFalso(pistas);
}

// Por defecto getUserMedia RECHAZA, igual que antes: jsdom no tiene micro y un
// test que necesite uno debe pedirlo a propósito con `__mediaDevices.darStream()`.
const RECHAZO_POR_DEFECTO = () => Promise.reject(new Error('sin medios en jsdom'));

const CONTROL_MEDIOS = {
  respuesta: RECHAZO_POR_DEFECTO,
  oyentes: new Set()
};

const mediaDevicesFalso = {
  ondevicechange: null,
  getUserMedia: vi.fn((restricciones) => CONTROL_MEDIOS.respuesta(restricciones)),
  addEventListener(evento, fn) { if (evento === 'devicechange') CONTROL_MEDIOS.oyentes.add(fn); },
  removeEventListener(evento, fn) { if (evento === 'devicechange') CONTROL_MEDIOS.oyentes.delete(fn); }
  // `enumerateDevices` NO se declara aquí a propósito: ver `sinDispositivos()`.
};

Object.defineProperty(navigator, 'mediaDevices', { writable: true, configurable: true, value: mediaDevicesFalso });

globalThis.__mediaDevices = {
  crearPista: crearPistaFalsa,
  crearStream: crearStreamFalso,

  /**
   * getUserMedia resolverá. Sin argumento se fabrica un stream a la medida de
   * las restricciones pedidas (audio y/o vídeo), que es lo que quiere el 90 % de
   * los casos.
   */
  darStream(stream) {
    CONTROL_MEDIOS.respuesta = (restricciones = {}) => Promise.resolve(
      stream || crearStreamFalso({
        audio: restricciones.audio ? 1 : 0,
        video: restricciones.video ? 1 : 0
      })
    );
  },

  /**
   * getUserMedia rechazará con un error cuyo `.name` es el que se pide. Es la
   * llave de la taxonomía del micrófono: 'NotAllowedError', 'NotFoundError',
   * 'NotReadableError', 'OverconstrainedError', 'SecurityError'…
   */
  fallarCon(nombre, mensaje) {
    CONTROL_MEDIOS.respuesta = () => {
      const e = new Error(mensaje || nombre);
      e.name = nombre;
      return Promise.reject(e);
    };
  },

  /**
   * getUserMedia se queda colgado y no resuelve nunca: el navegador que enseña
   * el diálogo de permiso y nadie lo contesta. Es el único camino para probar el
   * tope de espera del micro.
   */
  colgar() {
    CONTROL_MEDIOS.respuesta = () => new Promise(() => {});
  },

  /** Escotilla: la respuesta de getUserMedia la decide el test entero. */
  responder(fn) { CONTROL_MEDIOS.respuesta = fn; },

  /**
   * Declara `enumerateDevices` con esa lista. Está AUSENTE por defecto (ver
   * `sinDispositivos`), así que quien quiera probar el selector de aparatos
   * tiene que llamarlo.
   */
  conDispositivos(lista = []) {
    mediaDevicesFalso.enumerateDevices = vi.fn(() => Promise.resolve(lista));
  },

  /**
   * Quita `enumerateDevices`, que es el estado POR DEFECTO y es deliberado: el
   * código se protege comprobando que exista, y dárselo hacía que
   * `refreshDevices()` llamara a `setDevices` después de un `await` —una
   * actualización de estado fuera de `act()` que ensuciaba la salida de todos
   * los tests con un aviso que no señalaba nada real—.
   */
  sinDispositivos() {
    delete mediaDevicesFalso.enumerateDevices;
  },

  /** Unos auriculares enchufados (o retirados) a mitad de llamada. */
  emitirDeviceChange() {
    const evento = { type: 'devicechange' };
    if (typeof mediaDevicesFalso.ondevicechange === 'function') mediaDevicesFalso.ondevicechange(evento);
    for (const fn of [...CONTROL_MEDIOS.oyentes]) fn(evento);
  },

  /** Llamadas registradas a getUserMedia (útil para mirar las restricciones). */
  llamadas() { return mediaDevicesFalso.getUserMedia.mock.calls.map(([r]) => r); },

  reset() {
    CONTROL_MEDIOS.respuesta = RECHAZO_POR_DEFECTO;
    CONTROL_MEDIOS.oyentes.clear();
    mediaDevicesFalso.ondevicechange = null;
    mediaDevicesFalso.getUserMedia.mockClear();
    delete mediaDevicesFalso.enumerateDevices;
    contadorPista = 0;
    contadorStream = 0;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WEBRTC — RTCPeerConnection
// ─────────────────────────────────────────────────────────────────────────────

const SDP_FALSO = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
// Una muestra de calidad equivale a un ciclo de MUESTREO_CALIDAD (2 s): 50
// paquetes por segundo de audio y ~32 kbps de Opus. Los números concretos no
// importan; lo que importa es que dos muestras seguidas se puedan restar.
const PAQUETES_POR_MUESTRA = 100;
const BYTES_POR_MUESTRA = 8000;
const MS_POR_MUESTRA = 2000;

function errorDeEstado(mensaje) {
  const e = new Error(mensaje);
  e.name = 'InvalidStateError';
  return e;
}

class RTCPeerConnectionFalsa {
  constructor(config) {
    this.__config = config || null;
    this.__cerrado = false;
    this.__reiniciosIce = 0;
    this.__senders = [];
    this.__candidatosAnadidos = [];
    this.__oyentes = new Map();

    this.localDescription = null;
    this.remoteDescription = null;

    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.onicegatheringstatechange = null;
    this.onsignalingstatechange = null;
    this.onicecandidate = null;
    this.ontrack = null;
    this.onnegotiationneeded = null;

    this.__connectionState = 'new';
    this.__iceConnectionState = 'new';
    this.__iceGatheringState = 'new';
    this.__signalingState = 'stable';

    // Estadísticas: sin muestras, getStats() devuelve un Map VACÍO. Es el caso
    // que obliga al módulo de calidad a no declarar nunca 'enlazado_bien' sin
    // bytes medidos.
    this.__muestra = { paquetes: 0, perdidos: 0, bytes: 0, rttSeg: 0, jitter: 0, sello: 0 };
    this.__hayMuestra = false;
    this.__estadisticasFijas = null;
    this.__estadisticasError = null;

    RTCPeerConnectionFalsa.__instancias.push(this);
  }

  // Los cuatro estados son asignables y, al cambiar, disparan su manejador —
  // igual que el navegador—. Así `pc.connectionState = 'failed'` es todo lo que
  // hace falta para simular una ruta que se cae.
  get connectionState() { return this.__connectionState; }
  set connectionState(v) {
    if (this.__connectionState === v) return;
    this.__connectionState = v;
    this.__disparar('connectionstatechange');
  }
  get iceConnectionState() { return this.__iceConnectionState; }
  set iceConnectionState(v) {
    if (this.__iceConnectionState === v) return;
    this.__iceConnectionState = v;
    this.__disparar('iceconnectionstatechange');
  }
  get iceGatheringState() { return this.__iceGatheringState; }
  set iceGatheringState(v) {
    if (this.__iceGatheringState === v) return;
    this.__iceGatheringState = v;
    this.__disparar('icegatheringstatechange');
  }
  get signalingState() { return this.__signalingState; }
  set signalingState(v) {
    if (this.__signalingState === v) return;
    this.__signalingState = v;
    this.__disparar('signalingstatechange');
  }

  __disparar(tipo, evento = {}) {
    const manejador = this[`on${tipo}`];
    if (typeof manejador === 'function') manejador.call(this, { type: tipo, target: this, ...evento });
    const set = this.__oyentes.get(tipo);
    if (set) for (const fn of [...set]) fn({ type: tipo, target: this, ...evento });
  }

  addEventListener(tipo, fn) {
    if (!this.__oyentes.has(tipo)) this.__oyentes.set(tipo, new Set());
    this.__oyentes.get(tipo).add(fn);
  }
  removeEventListener(tipo, fn) {
    const set = this.__oyentes.get(tipo);
    if (set) set.delete(fn);
  }

  // ─── API del navegador ───
  createOffer() { return Promise.resolve({ type: 'offer', sdp: SDP_FALSO }); }
  createAnswer() { return Promise.resolve({ type: 'answer', sdp: SDP_FALSO }); }

  setLocalDescription(desc) {
    const tipo = desc?.type || (this.__signalingState === 'have-remote-offer' ? 'answer' : 'offer');
    this.localDescription = { type: tipo, sdp: desc?.sdp ?? SDP_FALSO };
    if (tipo === 'offer') this.signalingState = 'have-local-offer';
    else this.signalingState = 'stable';
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    const tipo = desc?.type;
    // El navegador de verdad LANZA aquí, y el bloque de negociación perfecta
    // tiene una guarda para no llegar a este punto. Si el doble tragase, esa
    // guarda dejaría de estar cubierta por nada.
    if (tipo === 'answer' && this.__signalingState !== 'have-local-offer') {
      return Promise.reject(errorDeEstado('setRemoteDescription(answer) fuera de have-local-offer'));
    }
    this.remoteDescription = { type: tipo, sdp: desc?.sdp ?? SDP_FALSO };
    // Una oferta remota estando en have-local-offer es la colisión (glare): el
    // lado educado hace rollback implícito y la acepta. No es un error.
    if (tipo === 'offer') this.signalingState = 'have-remote-offer';
    else this.signalingState = 'stable';
    return Promise.resolve();
  }

  addIceCandidate(candidato) {
    if (!this.remoteDescription) {
      return Promise.reject(errorDeEstado('addIceCandidate sin descripción remota'));
    }
    this.__candidatosAnadidos.push(candidato);
    return Promise.resolve();
  }

  addTrack(track, ...streams) {
    const sender = {
      track,
      __streams: streams,
      replaceTrack(nueva) { sender.track = nueva; return Promise.resolve(); },
      getParameters() { return { encodings: [] }; },
      setParameters() { return Promise.resolve(); }
    };
    this.__senders.push(sender);
    return sender;
  }
  removeTrack(sender) {
    this.__senders = this.__senders.filter(s => s !== sender);
    if (sender) sender.track = null;
  }
  getSenders() { return [...this.__senders]; }
  getReceivers() { return []; }
  getTransceivers() { return []; }

  /** El remedio barato del protocolo. Se cuenta en `__reiniciosIce`. */
  restartIce() {
    this.__reiniciosIce += 1;
    this.__iceGatheringState = 'gathering';
  }

  close() {
    // El navegador NO dispara eventos de estado después de close(): se escriben
    // los campos de respaldo directamente para no despertar la lógica de "par
    // caído" justo durante el desmontaje.
    this.__cerrado = true;
    this.__connectionState = 'closed';
    this.__iceConnectionState = 'closed';
    this.__signalingState = 'closed';
  }

  getStats() {
    if (this.__estadisticasError) return Promise.reject(this.__estadisticasError);
    if (this.__estadisticasFijas) return Promise.resolve(this.__estadisticasFijas);
    const informe = new Map();
    if (this.__hayMuestra) {
      const m = this.__muestra;
      informe.set('cp_1', {
        id: 'cp_1', type: 'candidate-pair', state: 'succeeded', nominated: true,
        currentRoundTripTime: m.rttSeg, timestamp: m.sello
      });
      informe.set('in_1', {
        id: 'in_1', type: 'inbound-rtp', kind: 'audio', mediaType: 'audio',
        packetsReceived: m.paquetes, packetsLost: m.perdidos,
        jitter: m.jitter, bytesReceived: m.bytes, timestamp: m.sello
      });
    }
    return Promise.resolve(informe);
  }

  // ─── Superficie de control para los tests ───

  /**
   * Añade UNA muestra de calidad, como si hubiera pasado un ciclo de muestreo.
   *
   *   rtt     en MILISEGUNDOS (el spec habla en ms; getStats devuelve segundos,
   *           y la conversión la hace este doble, no cada test).
   *   perdida fracción 0..1 de los paquetes de ESA muestra (0.02 = 2 %).
   *   bytes   INCREMENTO de bytesReceived en esa muestra. `bytes: 0` deja el
   *           contador plano, que es como se prueban los "bytes planos".
   */
  __simular({ rtt = 40, perdida = 0, bytes = BYTES_POR_MUESTRA, jitter = 0.01 } = {}) {
    const m = this.__muestra;
    m.paquetes += PAQUETES_POR_MUESTRA;
    m.perdidos += Math.round(PAQUETES_POR_MUESTRA * perdida);
    m.bytes += bytes;
    m.rttSeg = rtt / 1000;
    m.jitter = jitter;
    m.sello += MS_POR_MUESTRA;
    this.__hayMuestra = true;
    return this;
  }

  /** Informe de estadísticas exacto, para un caso que no encaje en __simular. */
  __estadisticas(informe) { this.__estadisticasFijas = informe; return this; }

  /** El navegador viejo que no tiene getStats. */
  __sinGetStats() { this.getStats = undefined; return this; }

  /** getStats existe pero revienta. */
  __getStatsFalla(error) {
    this.__estadisticasError = error || errorDeEstado('getStats no disponible');
    return this;
  }

  /** La ruta cuaja. */
  __conectar() {
    this.iceConnectionState = 'connected';
    this.connectionState = 'connected';
    return this;
  }
  /** La ruta se cae (el caso ESPERADO sin TURN, no la excepción). */
  __fallarIce() {
    this.iceConnectionState = 'failed';
    this.connectionState = 'failed';
    return this;
  }
  /** La ruta parpadea. */
  __desconectar() {
    this.iceConnectionState = 'disconnected';
    this.connectionState = 'disconnected';
    return this;
  }

  /** Un candidato ICE local listo para señalizar. Sin argumento, el fin de la recolección. */
  __candidato(candidate = { candidate: 'candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 }) {
    this.__disparar('icecandidate', { candidate });
    return this;
  }
  __finDeCandidatos() {
    this.iceGatheringState = 'complete';
    this.__disparar('icecandidate', { candidate: null });
    return this;
  }

  /** Llega media del otro extremo. */
  __pistaEntrante({ kind = 'audio', stream } = {}) {
    const track = crearPistaFalsa({ kind });
    const streams = [stream || new MediaStreamFalso([track])];
    this.__disparar('track', { track, streams, receiver: { track } });
    return track;
  }

  /** Cambio de pistas después de la negociación inicial. */
  __renegociar() { this.__disparar('negotiationneeded'); return this; }
}

RTCPeerConnectionFalsa.__instancias = [];
/** Todas las conexiones creadas en el test, en orden de creación. */
RTCPeerConnectionFalsa.__todas = () => [...RTCPeerConnectionFalsa.__instancias];
/** La última creada (el atajo del 90 % de los casos). */
RTCPeerConnectionFalsa.__ultima = () => RTCPeerConnectionFalsa.__instancias.at(-1);
/** Las que siguen vivas: la prueba de "no se cerró ningún par en el hueco". */
RTCPeerConnectionFalsa.__abiertas = () => RTCPeerConnectionFalsa.__instancias.filter(pc => !pc.__cerrado);
RTCPeerConnectionFalsa.__reset = () => { RTCPeerConnectionFalsa.__instancias = []; };

globalThis.RTCPeerConnection = RTCPeerConnectionFalsa;
globalThis.RTCSessionDescription = class { constructor(init) { Object.assign(this, init); } };
globalThis.RTCIceCandidate = class { constructor(init) { Object.assign(this, init); } };

// jsdom no reproduce medios
window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
window.HTMLMediaElement.prototype.pause = vi.fn();

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — /ice-config
// ─────────────────────────────────────────────────────────────────────────────

// Node ya trae `fetch`, así que el `if (!globalThis.fetch)` de antes NUNCA
// instalaba el doble: cualquier test que rozara la carga de ICE salía a la red
// de verdad y se salvaba sólo porque el error lo tragaba un catch. Ahora se
// instala siempre.
const ICE_POR_DEFECTO = { iceServers: [], turnMode: 'free-fallback', turnConfigured: false };

const CONTROL_FETCH = {
  llamadas: [],
  ice: { ...ICE_POR_DEFECTO },
  responder: null
};

function respuestaJson(cuerpo, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(cuerpo),
    text: () => Promise.resolve(JSON.stringify(cuerpo))
  };
}

// Sólo `/ice-config` responde. `/api/turn-credentials` —la ruta que el cliente
// pide hoy y que el servidor no define— devuelve 404, que es la verdad: si el
// doble la sirviera, el arreglo de la URL dejaría de notarse en ningún test.
function responderPorDefecto(url) {
  if (url.includes('/ice-config')) return respuestaJson(CONTROL_FETCH.ice);
  return respuestaJson({ error: `sin doble para ${url}` }, 404);
}

globalThis.fetch = vi.fn((url, opciones) => {
  const dir = String(url);
  CONTROL_FETCH.llamadas.push({ url: dir, opciones });
  const respuesta = (CONTROL_FETCH.responder || responderPorDefecto)(dir, opciones);
  return Promise.resolve(respuesta);
});

globalThis.__fetch = {
  respuestaJson,
  /** Todo lo pedido, en orden: { url, opciones }. */
  llamadas() { return [...CONTROL_FETCH.llamadas]; },
  ultimaUrl() { return CONTROL_FETCH.llamadas.at(-1)?.url; },
  /** Cambia lo que devuelve /ice-config (p. ej. turnMode: 'cloudflare'). */
  iceConfig(parcial) { CONTROL_FETCH.ice = { ...CONTROL_FETCH.ice, ...parcial }; },
  /** Escotilla: el test decide la respuesta de cualquier URL. */
  responder(fn) { CONTROL_FETCH.responder = fn; },
  reset() {
    CONTROL_FETCH.llamadas = [];
    CONTROL_FETCH.ice = { ...ICE_POR_DEFECTO };
    CONTROL_FETCH.responder = null;
    globalThis.fetch.mockClear();
  }
};

afterEach(() => {
  cleanup();
  // Un test que se deja los temporizadores falsos puestos envenena al siguiente
  // dentro del mismo fichero y, peor, al fichero siguiente del mismo worker.
  vi.useRealTimers();
  globalThis.__socket.reset();
  globalThis.__fetch.reset();
  globalThis.__mediaDevices.reset();
  globalThis.__audio.reset();
  globalThis.__vibracion.reset();
  globalThis.RTCPeerConnection.__reset();
  localStorage.clear();
  sessionStorage.clear();
});
