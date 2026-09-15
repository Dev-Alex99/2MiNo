/**
 * Medios locales: micrófono, cámara, altavoz, aparatos y detección de voz.
 *
 * Sale entero de `useVoiceChat` (:113-198 y :359-488) con tres arreglos que no
 * son de estilo:
 *
 * 1. EL ERROR DEL MICRO ABORTA LA LLAMADA. Antes, `ensureMicStream` hacía
 *    `console.warn` y devolvía null, nadie comprobaba el null, y
 *    `createPoolPeer` acababa creando una RTCPeerConnection SIN NINGUNA PISTA:
 *    la llamada se establecía, la interfaz decía «Conectado P2P» y estabas mudo
 *    para siempre. Aquí `pedirMicro()` LANZA con su motivo y su clave i18n.
 *    Prohibido el modo «solo escucha» silencioso: existe como botón etiquetado,
 *    no como consecuencia de un fallo.
 * 2. EL VAD BAJA DE requestAnimationFrame A setInterval. 60 Hz no aporta nada
 *    para detectar voz, y rAF SE CONGELA en pestaña oculta, que es justo cuando
 *    más importa seguir midiendo (una llamada con la pestaña de fondo es el caso
 *    normal, no la excepción).
 * 3. SE PARAN LAS PISTAS VIEJAS AL CAMBIAR DE MICRO. `selectMic` machacaba la
 *    referencia sin `.stop()`: el micro anterior seguía capturando y el piloto
 *    de grabación del sistema seguía encendido. `selectCam` sí lo hacía bien, lo
 *    que confirma que era un olvido.
 *
 * Se retira `voiceFilter` y su `rawStreamRef`: se declaraban, viajaban por props
 * y no tocaban un solo nodo de Web Audio. `rawStreamRef` recibía el MISMO objeto
 * que `localStreamRef`, así que su único efecto era parar las mismas pistas dos
 * veces. Los seis botones los retira P6 con su aviso.
 */

import { crearDetector, rmsDe } from './vad';
import { MIC_TOPE, VAD_MUESTREO, NIVEL_PALABRA } from './tiempos';

const MIC_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

const CAM_CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 480 } };

export const CAN_PICK_SPEAKER =
  typeof document !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype;

export function recall(key) {
  try { return localStorage.getItem(`domino_voice_${key}`) || ''; } catch { return ''; }
}

export function store(key, val) {
  try { localStorage.setItem(`domino_voice_${key}`, val); } catch { /* noop */ }
}

function withDevice(constraints, deviceId) {
  if (!deviceId) return constraints;
  return { ...constraints, deviceId: { exact: deviceId } };
}

/**
 * Taxonomía del contrato §6. La clave i18n de cada motivo YA EXISTE en los tres
 * idiomas desde que se desmanteló la interfaz de voz: se reconectan, no se
 * inventan.
 */
export const CLAVE_DE_MOTIVO = {
  micro_bloqueado: 'voice.errMic',
  micro_ausente: 'voice.errNoMic',
  micro_ocupado: 'voice.errBusyMic',
  micro_desaparecido: 'voice.errMicGone',
  micro_sin_respuesta: 'linea.micSinRespuesta',
  micro_desconocido: 'voice.errGenericMic'
};

export const CLAVE_DE_MOTIVO_CAMARA = {
  micro_bloqueado: 'voice.errCam',
  micro_ausente: 'voice.errNoCam',
  micro_ocupado: 'voice.errBusyCam',
  micro_desaparecido: 'voice.errCamGone',
  micro_sin_respuesta: 'voice.errGenericCam',
  micro_desconocido: 'voice.errGenericCam'
};

export function motivoDeError(e) {
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'micro_bloqueado';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'micro_ausente';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'micro_ocupado';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'micro_desaparecido';
    default:
      return 'micro_desconocido';
  }
}

export function errorDeMicro(motivo, camara = false) {
  const e = new Error(motivo);
  e.motivo = motivo;
  e.clave = (camara ? CLAVE_DE_MOTIVO_CAMARA : CLAVE_DE_MOTIVO)[motivo] || 'voice.errGenericMic';
  return e;
}

/** El tope de 12 s. Sin él, un diálogo de permiso que nadie contesta cuelga la llamada sin motivo. */
function conTope(promesa, ms) {
  return new Promise((resolve, reject) => {
    const reloj = setTimeout(() => reject(errorDeMicro('micro_sin_respuesta')), ms);
    promesa.then(
      (v) => { clearTimeout(reloj); resolve(v); },
      (e) => { clearTimeout(reloj); reject(e); }
    );
  });
}

/**
 * @param {object} avisos
 *   alHablar(bool)          transición del detector de voz (sólo los cambios)
 *   alNivel(segmentos, palabra)  medidor de entrada, 0..7 y su equivalente hablado
 *   alDispositivos(lista)   micros, cámaras y altavoces
 *   alVideo(stream|null)    la cámara propia
 */
export function crearMediosLocales({ alHablar, alNivel, alDispositivos, alVideo } = {}) {
  let micro = null;          // MediaStream del micrófono
  let camara = null;         // MediaStream de la cámara
  let silenciado = false;
  let altavoz = recall('speaker');

  // Detección de voz.
  let ctxAudio = null;
  let analizador = null;
  let detector = null;
  let reloj = null;
  let ultimaPalabra = null;
  let selloPalabra = 0;
  let ultimosSegmentos = -1;

  const avisar = (fn, ...args) => { if (typeof fn === 'function') fn(...args); };

  function pararDeteccion() {
    if (reloj) { clearInterval(reloj); reloj = null; }
    if (ctxAudio) {
      try { ctxAudio.close(); } catch { /* ya cerrado */ }
      ctxAudio = null;
    }
    analizador = null;
    detector = null;
    ultimaPalabra = null;
    ultimosSegmentos = -1;
    avisar(alNivel, 0, 'linea.nivelSinSenal');
  }

  /**
   * El equivalente hablado del medidor. Devuelve la CLAVE COMPLETA, igual que
   * `micError.clave` y que las claves de la crónica: quien pinta hace `t(clave)`
   * y no tiene que recordar a qué familia pertenece cada cadena. Un nombre suelto
   * ('nivelDebil') obligaría a componer el prefijo a mano en cada consumidor, y
   * componer prefijos a mano es como se escriben claves que no existen.
   */
  function palabraDeNivel(rms) {
    if (rms < 0.01) return 'linea.nivelSinSenal';
    if (rms < 0.045) return 'linea.nivelDebil';
    return 'linea.nivelCorrecta';
  }

  function iniciarDeteccion(stream) {
    pararDeteccion();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return;

    try {
      const ctx = new Ctx();
      // Un AudioContext creado sin gesto del usuario nace 'suspended'. Hoy se
      // salva porque siempre se llega desde un clic; en cuanto existe «restaurar
      // la llamada tras reconectar» se queda suspendido y el indicador no se
      // enciende jamás, sin error y sin síntoma.
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try { ctx.resume(); } catch { /* el navegador lo reintentará al primer gesto */ }
      }
      const fuente = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.4;
      fuente.connect(an);

      const muestras = new Uint8Array(an.fftSize);
      ctxAudio = ctx;
      analizador = an;
      detector = crearDetector();

      reloj = setInterval(() => {
        if (!analizador || !detector) return;
        if (silenciado) {
          if (detector.reiniciar()) avisar(alHablar, false);
          if (ultimosSegmentos !== 0) { ultimosSegmentos = 0; avisar(alNivel, 0, 'linea.nivelSinSenal'); }
          return;
        }
        analizador.getByteTimeDomainData(muestras);
        const rms = rmsDe(muestras);
        const cambio = detector.procesar(rms, Date.now());
        if (cambio !== null) avisar(alHablar, cambio);

        // El medidor se publica por SEGMENTOS (0..7), no por valor continuo: un
        // store que cambie diez veces por segundo repinta la aplicación entera.
        const segmentos = Math.min(7, Math.round(rms * 7 / 0.14));
        const palabra = palabraDeNivel(rms);
        const ahora = Date.now();
        const tocaPalabra = palabra !== ultimaPalabra && ahora - selloPalabra >= NIVEL_PALABRA;
        if (segmentos !== ultimosSegmentos || tocaPalabra) {
          ultimosSegmentos = segmentos;
          if (tocaPalabra) { ultimaPalabra = palabra; selloPalabra = ahora; }
          avisar(alNivel, segmentos, ultimaPalabra || palabra);
        }
      }, VAD_MUESTREO);
    } catch (e) {
      console.warn('[voz] no se pudo iniciar la detección de habla:', e.message);
    }
  }

  async function pedirStream(restricciones, camaraP = false) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw errorDeMicro('micro_ausente', camaraP);
    }
    return conTope(navigator.mediaDevices.getUserMedia(restricciones), MIC_TOPE);
  }

  async function refrescarDispositivos() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const lista = await navigator.mediaDevices.enumerateDevices();
      avisar(alDispositivos, {
        mics: lista.filter(d => d.kind === 'audioinput'),
        cams: lista.filter(d => d.kind === 'videoinput'),
        speakers: lista.filter(d => d.kind === 'audiooutput')
      });
    } catch { /* noop */ }
  }

  const alCambiarAparatos = () => { refrescarDispositivos(); };

  return {
    /* ─── Micrófono ─── */

    /**
     * Devuelve el stream del micro, pidiéndolo si hace falta. LANZA un error con
     * `.motivo` y `.clave` si no se puede: quien llama tiene que abortar.
     */
    async pedirMicro() {
      if (micro) return micro;
      const recordado = recall('mic');
      let stream;
      try {
        stream = await pedirStream({ audio: withDevice(MIC_CONSTRAINTS, recordado), video: false });
      } catch (e) {
        const motivo = e.motivo || motivoDeError(e);
        // El aparato recordado ya no está. Se reintenta SIN `deviceId:{exact}`
        // antes de rendirse: hasta ahora, cambiar de auriculares mataba la
        // llamada sin reintento y sin mensaje.
        if (motivo === 'micro_desaparecido' && recordado) {
          try {
            stream = await pedirStream({ audio: { ...MIC_CONSTRAINTS }, video: false });
            store('mic', '');
          } catch (e2) {
            throw errorDeMicro(e2.motivo || motivoDeError(e2));
          }
        } else {
          throw errorDeMicro(motivo);
        }
      }
      micro = stream;
      stream.getAudioTracks().forEach(p => { p.enabled = !silenciado; });
      refrescarDispositivos();
      iniciarDeteccion(stream);
      return stream;
    },

    streamDeMicro() { return micro; },
    hayMicro() { return !!micro; },

    silenciar(v) {
      silenciado = !!v;
      if (micro) micro.getAudioTracks().forEach(p => { p.enabled = !silenciado; });
      return silenciado;
    },
    estaSilenciado() { return silenciado; },

    /** Cambio de micro en caliente. Devuelve la pista nueva para el `replaceTrack`. */
    async elegirMicro(deviceId) {
      store('mic', deviceId);
      if (!micro) return null;
      const nuevo = await pedirStream({ audio: withDevice(MIC_CONSTRAINTS, deviceId), video: false })
        .catch(e => { throw errorDeMicro(e.motivo || motivoDeError(e)); });
      // Parar ANTES de soltar la referencia: si no, el micro viejo sigue
      // capturando y el piloto de grabación del sistema sigue encendido.
      micro.getTracks().forEach(p => p.stop());
      micro = nuevo;
      nuevo.getAudioTracks().forEach(p => { p.enabled = !silenciado; });
      // Y reiniciar el detector: seguía midiendo un stream ya parado.
      iniciarDeteccion(nuevo);
      return nuevo.getAudioTracks()[0] || null;
    },

    /* ─── Cámara ─── */

    async encenderCamara() {
      if (camara) return camara;
      const stream = await pedirStream({ video: withDevice(CAM_CONSTRAINTS, recall('cam')) }, true)
        .catch(e => { throw errorDeMicro(e.motivo || motivoDeError(e), true); });
      camara = stream;
      avisar(alVideo, stream);
      return stream;
    },

    apagarCamara() {
      if (camara) camara.getTracks().forEach(p => p.stop());
      camara = null;
      avisar(alVideo, null);
    },

    streamDeCamara() { return camara; },
    pistaDeVideo() { return camara ? camara.getVideoTracks()[0] || null : null; },

    async elegirCamara(deviceId) {
      store('cam', deviceId);
      if (!camara) return null;
      const nuevo = await pedirStream({ video: withDevice(CAM_CONSTRAINTS, deviceId) }, true)
        .catch(e => { throw errorDeMicro(e.motivo || motivoDeError(e), true); });
      camara.getTracks().forEach(p => p.stop());
      camara = nuevo;
      avisar(alVideo, nuevo);
      return nuevo.getVideoTracks()[0] || null;
    },

    /* ─── Altavoz ─── */

    elegirAltavoz(deviceId) { store('speaker', deviceId); altavoz = deviceId; return deviceId; },
    altavozActual() { return altavoz; },

    /* ─── Aparatos ─── */

    refrescarDispositivos,

    /**
     * Unos auriculares enchufados a mitad de llamada. Antes no había un solo
     * `devicechange` en todo el cliente: no aparecían hasta recargar.
     */
    escucharAparatos() {
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', alCambiarAparatos);
      }
    },
    dejarDeEscucharAparatos() {
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', alCambiarAparatos);
      }
    },

    /* ─── Fin ─── */

    /** Suelta TODO: pistas paradas, detector parado, contexto de audio cerrado. */
    soltar() {
      pararDeteccion();
      if (micro) micro.getTracks().forEach(p => p.stop());
      micro = null;
      if (camara) camara.getTracks().forEach(p => p.stop());
      camara = null;
      avisar(alVideo, null);
      silenciado = false;
    }
  };
}
