import { useCallback, useEffect, useRef, useState } from 'react';
import { socket, serverUrl } from '../socket';
import { useT } from '../i18n/LanguageContext';

/**
 * Chat de voz en malla (P2P) sobre la señalización de Socket.IO que ya existe.
 *
 * Con un máximo de 4 jugadores la malla es óptima: cada uno mantiene 3
 * conexiones de ~24 kbps y el audio NUNCA pasa por el servidor. Un SFU solo
 * compensaría a partir de ~6 participantes.
 */

// --- Ajustes de Opus pensados para redes malas ---
// useinbandfec: reconstruye paquetes perdidos sin retransmitir (clave con pérdida).
// usedtx: deja de transmitir en silencio (en el dominó se calla mucho).
// stereo=0 y maxaveragebitrate: la voz no necesita más; el estéreo duplica a cambio de nada.
const OPUS_PARAMS = {
  stereo: '0',
  'sprop-stereo': '0',
  useinbandfec: '1',
  usedtx: '1',
  maxaveragebitrate: '24000',
  minptime: '10'
};

const MAX_BITRATE = 24000;
const MAX_ICE_RESTARTS = 3;

const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,   // sin esto, quien use altavoz mete eco a todos
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  },
  video: false
};

// --- Cámara: miniaturas, y solo miniaturas ---
// En malla, cada dispositivo codifica el vídeo UNA VEZ POR PEER. Con 3 peers son
// 3 codificaciones simultáneas: es lo que quema batería, no el ancho de banda.
// A 240p/15fps eso es asumible; a 720p sería un horno. En un dominó se mira al
// tablero, no a las caras, así que una miniatura sobra.
const CAM_CONSTRAINTS = {
  video: {
    width: { ideal: 320, max: 640 },
    height: { ideal: 240, max: 480 },
    frameRate: { ideal: 15, max: 20 },
    facingMode: 'user'
  },
  audio: false
};

const VIDEO_MAX_BITRATE = 200000; // 200 kbps por peer
const VIDEO_MAX_FPS = 15;

// Recordar los dispositivos elegidos entre partidas.
const STORE = { mic: 'domino_mic_id', cam: 'domino_cam_id', speaker: 'domino_speaker_id' };
const remember = (k, v) => { try { v ? localStorage.setItem(STORE[k], v) : localStorage.removeItem(STORE[k]); } catch { /* modo privado */ } };
const recall = (k) => { try { return localStorage.getItem(STORE[k]) || ''; } catch { return ''; } };

// El navegador soporta elegir altavoz (setSinkId)? Chrome/Edge sí; otros no.
const CAN_PICK_SPEAKER = typeof HTMLMediaElement !== 'undefined' &&
  'setSinkId' in HTMLMediaElement.prototype;

/**
 * Construye las restricciones de captura.
 * exact  -> el usuario ha elegido ese aparato a propósito: si no está, que falle
 *           y se le diga, en vez de darle otro en silencio.
 * ideal  -> venimos de localStorage y el aparato puede que ya no exista: mejor
 *           caer al predeterminado que reventar con OverconstrainedError.
 */
function withDevice(base, deviceId, strict) {
  if (!deviceId) return base;
  return { ...base, deviceId: strict ? { exact: deviceId } : { ideal: deviceId } };
}

// Reescribe la línea fmtp de Opus con nuestros parámetros, respetando los que
// ya vengan y sin tocar el resto del SDP. Idempotente.
export function tuneOpusSdp(sdp) {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];

  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const existing = sdp.match(fmtpRe);

  const params = {};
  if (existing) {
    existing[1].split(';').forEach(kv => {
      const [k, v] = kv.split('=');
      if (k && v !== undefined) params[k.trim()] = v.trim();
    });
  }
  Object.assign(params, OPUS_PARAMS);
  const line = `a=fmtp:${pt} ` + Object.entries(params).map(([k, v]) => `${k}=${v}`).join(';');

  return existing
    ? sdp.replace(fmtpRe, line)
    : sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000[^\\r\\n]*)`), `$1\r\n${line}`);
}

// Limita el vídeo saliente. maintain-framerate: ante congestión preferimos que
// baje la nitidez antes que ver a la gente a trompicones.
async function tuneVideoSender(sender) {
  if (!sender || !sender.getParameters) return;
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
    params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
    params.encodings[0].maxFramerate = VIDEO_MAX_FPS;
    params.degradationPreference = 'maintain-framerate';
    await sender.setParameters(params);
  } catch { /* si el navegador no lo admite, la restricción de captura ya limita */ }
}

export default function useVoiceChat({ roomId, playerId }) {
  // Ref al traductor para no invalidar los useCallback al cambiar de idioma.
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);
  // playerId -> 'connecting' | 'connected' | 'failed'
  const [peerStates, setPeerStates] = useState({});
  const [speaking, setSpeaking] = useState({});
  const [camOn, setCamOn] = useState(false);
  const [camBusy, setCamBusy] = useState(false);
  const [localVideo, setLocalVideo] = useState(null);
  // playerId -> MediaStream de vídeo del peer
  const [remoteVideos, setRemoteVideos] = useState({});
  const [devices, setDevices] = useState({ mics: [], cams: [], speakers: [] });
  const [selected, setSelected] = useState({
    mic: recall('mic'), cam: recall('cam'), speaker: recall('speaker')
  });
  const [switching, setSwitching] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState('normal'); // 'normal' | 'megaphone' | 'robot'

  const mutedRef = useRef(false);
  const speakerRef = useRef(recall('speaker'));

  const localStreamRef = useRef(null);
  const rawStreamRef = useRef(null);
  const filterCtxRef = useRef(null);
  const filterNodesRef = useRef([]);
  const voiceFilterRef = useRef('normal');
  voiceFilterRef.current = voiceFilter;

  const camStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const iceConfigRef = useRef(null);
  const joinedRef = useRef(false);
  const vadRef = useRef(null);

  // --- Procesador WebAudio DSP de Filtros de Voz ---
  const setupVoiceFilterGraph = useCallback((rawStream, filterType) => {
    if (!rawStream) return rawStream;

    if (filterCtxRef.current) {
      try {
        filterNodesRef.current.forEach(n => {
          if (n.stop) n.stop();
          if (n.disconnect) n.disconnect();
        });
        filterCtxRef.current.close().catch(() => {});
      } catch (e) {}
      filterCtxRef.current = null;
      filterNodesRef.current = [];
    }

    if (!filterType || filterType === 'normal') {
      return rawStream;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      ctx.resume().catch(() => {});

      const source = ctx.createMediaStreamSource(rawStream);
      const dest = ctx.createMediaStreamDestination();
      const nodes = [];

      if (filterType === 'megaphone') {
        // 📢 Megáfono / Anunciador: Pasa-alto 1000Hz + Pasa-bajo 3200Hz + Distorsión WaveShaper
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1000;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3200;

        const shaper = ctx.createWaveShaper();
        const samples = 44100;
        const curve = new Float32Array(samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < samples; ++i) {
          const x = (i * 2) / samples - 1;
          curve[i] = ((3 + 15) * x * 20 * deg) / (Math.PI + 15 * Math.abs(x));
        }
        shaper.curve = curve;
        shaper.oversample = '4x';

        const gain = ctx.createGain();
        gain.gain.value = 1.6;

        source.connect(hp);
        hp.connect(lp);
        lp.connect(shaper);
        shaper.connect(gain);
        gain.connect(dest);

        nodes.push(hp, lp, shaper, gain);
      } else if (filterType === 'robot') {
        // 🤖 Robot Cyborg: Modulación de anillo a 65Hz + Filtro Formante
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 65;

        const ringGain = ctx.createGain();
        ringGain.gain.value = 0.85;

        const formant = ctx.createBiquadFilter();
        formant.type = 'peaking';
        formant.frequency.value = 1800;
        formant.Q.value = 4;
        formant.gain.value = 10;

        const outGain = ctx.createGain();
        outGain.gain.value = 1.4;

        source.connect(ringGain);
        osc.connect(ringGain.gain);
        ringGain.connect(formant);
        formant.connect(outGain);
        outGain.connect(dest);

        osc.start();
        nodes.push(osc, ringGain, formant, outGain);
      } else if (filterType === 'alien') {
        // 👾 Voz Alienígena: Modulación LFO rápida (14Hz) + High-Shelf 1500Hz
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 14;

        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.004;

        const delay = ctx.createDelay();
        delay.delayTime.value = 0.015;

        const filter = ctx.createBiquadFilter();
        filter.type = 'highshelf';
        filter.frequency.value = 1500;
        filter.gain.value = 12;

        const outGain = ctx.createGain();
        outGain.gain.value = 1.3;

        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        source.connect(filter);
        filter.connect(delay);
        delay.connect(outGain);
        outGain.connect(dest);

        lfo.start();
        nodes.push(lfo, lfoGain, delay, filter, outGain);
      } else if (filterType === 'monster') {
        // 👹 Monstruo / Ogro: Refuerzo de Sub-Graves (+14dB a 150Hz) + Modulación Sub-octava 40Hz
        const bass = ctx.createBiquadFilter();
        bass.type = 'lowshelf';
        bass.frequency.value = 180;
        bass.gain.value = 14;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 40;

        const subGain = ctx.createGain();
        subGain.gain.value = 0.65;

        const outGain = ctx.createGain();
        outGain.gain.value = 1.5;

        source.connect(bass);
        bass.connect(lp);
        lp.connect(subGain);
        osc.connect(subGain.gain);
        subGain.connect(outGain);
        outGain.connect(dest);

        osc.start();
        nodes.push(bass, lp, osc, subGain, outGain);
      } else if (filterType === 'radio') {
        // 📻 Walkie-Talkie / Piloto: Pasa-banda angosto 1500Hz + Distorsión militar
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 3.5;

        const shaper = ctx.createWaveShaper();
        const samples = 44100;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; ++i) {
          const x = (i * 2) / samples - 1;
          curve[i] = x * 2.5;
        }
        shaper.curve = curve;

        const outGain = ctx.createGain();
        outGain.gain.value = 1.8;

        source.connect(bp);
        bp.connect(shaper);
        shaper.connect(outGain);
        outGain.connect(dest);

        nodes.push(bp, shaper, outGain);
      }

      filterCtxRef.current = ctx;
      filterNodesRef.current = nodes;

      const rawTrack = rawStream.getAudioTracks()[0];
      const procTrack = dest.stream.getAudioTracks()[0];
      if (rawTrack && procTrack) {
        procTrack.enabled = rawTrack.enabled;
      }

      return dest.stream;
    } catch (e) {
      console.warn('[Voz] Fallo al aplicar filtro WebAudio:', e);
      return rawStream;
    }
  }, []);

  // --- Configuración ICE (STUN siempre; TURN si el servidor lo tiene) ---
  const loadIceConfig = useCallback(async () => {
    if (iceConfigRef.current) return iceConfigRef.current;
    let iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/ice-config`);
      if (res.ok) {
        const cfg = await res.json();
        if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) iceServers = cfg.iceServers;
      }
    } catch {
      // Si el endpoint falla seguimos con STUN público: mejor eso que nada.
    }
    iceConfigRef.current = {
      iceServers,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };
    return iceConfigRef.current;
  }, []);

  /**
   * Lista los dispositivos disponibles.
   * OJO: los nombres (label) vienen VACÍOS hasta que hay permiso concedido. Por
   * eso solo tiene sentido llamar a esto después de getUserMedia; antes saldría
   * "Micrófono 1", "Micrófono 2"... y no serviría de nada.
   */
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        mics: list.filter(d => d.kind === 'audioinput'),
        cams: list.filter(d => d.kind === 'videoinput'),
        speakers: CAN_PICK_SPEAKER ? list.filter(d => d.kind === 'audiooutput') : []
      });
    } catch { /* sin permisos aún */ }
  }, []);

  // Si se enchufa o desenchufa un aparato, la lista se actualiza sola.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md || !md.addEventListener) return undefined;
    md.addEventListener('devicechange', refreshDevices);
    return () => md.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

  const setPeerState = useCallback((id, state) => {
    setPeerStates(prev => (prev[id] === state ? prev : { ...prev, [id]: state }));
  }, []);

  const destroyPeer = useCallback((id) => {
    const peer = peersRef.current.get(id);
    if (!peer) return;
    if (peer.recoverTimer) { clearTimeout(peer.recoverTimer); peer.recoverTimer = null; }
    try { peer.pc.close(); } catch { /* ya cerrada */ }
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    peersRef.current.delete(id);
    setPeerStates(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSpeaking(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRemoteVideos(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * Crea la conexión con un peer. SÍNCRONA a propósito: si tuviera un `await`
   * antes de registrar el peer en el mapa, dos señales casi simultáneas del
   * mismo peer crearían dos RTCPeerConnection y una quedaría huérfana. Por eso
   * la config ICE se precarga en join().
   */
  const createPeer = useCallback((peerId) => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const config = iceConfigRef.current;
    if (!config) return null;

    const pc = new RTCPeerConnection(config);

    // Desempate determinista: si ambos ofertan a la vez, uno cede.
    const peer = {
      pc,
      polite: String(playerId) < String(peerId),
      makingOffer: false,
      ignoreOffer: false,
      audio: null,
      audioSender: null,
      videoSender: null,
      restarts: 0,
      // Candidatos ICE que llegan antes de tener descripción remota: se guardan
      // y se aplican en cuanto exista, para no perder rutas (causa de enlaces
      // que fallan de forma intermitente).
      pendingCandidates: [],
      // Temporizador de recuperación cuando la conexión queda 'disconnected'.
      recoverTimer: null
    };
    peersRef.current.set(peerId, peer); // síncrono: sin ventana para duplicados
    setPeerState(peerId, 'connecting');

    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        // Se guarda el sender: cambiar de micrófono es replaceTrack() sobre él.
        peer.audioSender = pc.addTrack(track, stream);
      });
    }

    // Transceiver de vídeo creado YA, aunque no haya cámara. Así encender y
    // apagar la cam es un replaceTrack() instantáneo y NO renegocia la conexión
    // (que es lo que provocaría cortes en el audio cada vez).
    peer.videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    if (camStreamRef.current) {
      const track = camStreamRef.current.getVideoTracks()[0];
      if (track) peer.videoSender.replaceTrack(track).then(() => tuneVideoSender(peer.videoSender));
    }

    // Limitar el bitrate de subida: la voz no necesita más.
    const capBitrate = async () => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (!sender || !sender.getParameters) return;
      try {
        const params = sender.getParameters();
        params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = MAX_BITRATE;
        params.encodings[0].networkPriority = 'high';
        params.encodings[0].priority = 'high';
        await sender.setParameters(params);
      } catch { /* algunos navegadores no lo permiten; el SDP ya lo limita */ }
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        const description = { ...pc.localDescription.toJSON() };
        description.sdp = tuneOpusSdp(description.sdp);
        socket.emit('voice_signal', { to: peerId, data: { description } });
      } catch (e) {
        console.warn('[voz] fallo negociando', e);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('voice_signal', { to: peerId, data: { candidate } });
    };

    pc.ontrack = ({ track, streams }) => {
      if (track.kind === 'audio') {
        if (!peer.audio) {
          // En el DOM (oculto): iOS Safari es poco fiable con elementos sueltos.
          const audio = document.createElement('audio');
          audio.autoplay = true;
          audio.setAttribute('playsinline', '');
          audio.style.display = 'none';
          document.body.appendChild(audio);
          // Un peer que llega después también debe sonar por el altavoz elegido.
          if (speakerRef.current && audio.setSinkId) {
            audio.setSinkId(speakerRef.current).catch(() => {});
          }
          peer.audio = audio;
        }
        peer.audio.srcObject = streams[0] || new MediaStream([track]);
        // El gesto de pulsar "Entrar a la voz" nos habilita el autoplay.
        peer.audio.play().catch(() => {});
        return;
      }

      // Vídeo. Aquí solo se guarda el stream; QUIÉN tiene la cámara encendida
      // lo dice el estado del jugador, no el track: comprobado que
      // replaceTrack(null) NO pone el track remoto en "muted", así que fiarse de
      // eso dejaría el último fotograma congelado al apagar la cámara.
      const stream = streams[0] || new MediaStream([track]);
      setRemoteVideos(prev => (prev[peerId] === stream ? prev : { ...prev, [peerId]: stream }));

      track.onended = () => {
        setRemoteVideos(prev => {
          if (!prev[peerId]) return prev;
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
      };
    };

    // --- Robustez: recuperar la conexión cuando la red se cae ---
    // Reintento de ICE acotado y protegido: solo si el peer sigue siendo este.
    const scheduleRestart = (delay) => {
      if (peer.restarts >= MAX_ICE_RESTARTS) return;
      peer.restarts++;
      setTimeout(() => {
        if (peersRef.current.get(peerId) !== peer) return;
        const s = pc.connectionState;
        if (s === 'connected' || s === 'closed') return; // ya se recuperó
        try { pc.restartIce(); } catch { /* navegador antiguo */ }
      }, delay);
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (peer.recoverTimer) { clearTimeout(peer.recoverTimer); peer.recoverTimer = null; }

      if (st === 'connected') {
        peer.restarts = 0;
        setPeerState(peerId, 'connected');
        capBitrate();
      } else if (st === 'new' || st === 'connecting') {
        setPeerState(peerId, 'connecting');
      } else if (st === 'disconnected') {
        // Suele ser transitorio; damos margen y, si no se recupera solo,
        // forzamos un reinicio de ICE (antes se quedaba colgado para siempre).
        setPeerState(peerId, 'connecting');
        peer.recoverTimer = setTimeout(() => {
          peer.recoverTimer = null;
          if (peersRef.current.get(peerId) !== peer) return;
          if (pc.connectionState === 'disconnected') scheduleRestart(0);
        }, 4000);
      } else if (st === 'failed') {
        setPeerState(peerId, 'failed');
        scheduleRestart(500 * (peer.restarts + 1));
      }
    };

    return peer;
  }, [playerId, setPeerState]);

  // --- Detección de voz: analizamos NUESTRO micro, no los remotos ---
  // Analizar los streams remotos costaría N analizadores (CPU y batería en
  // móvil). Cada cliente detecta su propia voz y emite un booleano al cambiar.
  const startVAD = useCallback((stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      ctx.resume().catch(() => {}); // algunos navegadores lo crean suspendido
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let talking = false;
      let quietTicks = 0;

      const timer = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);

        const isMuted = !stream.getAudioTracks().some(t => t.enabled);
        // Histéresis: entra rápido al hablar y sale con retardo, para que el
        // indicador no parpadee entre sílabas.
        if (!isMuted && rms > 14) {
          quietTicks = 0;
          if (!talking) {
            talking = true;
            socket.emit('voice_speaking', { speaking: true });
            setSpeaking(prev => ({ ...prev, [playerId]: true }));
          }
        } else if (talking) {
          quietTicks++;
          if (quietTicks > 6) {
            talking = false;
            socket.emit('voice_speaking', { speaking: false });
            setSpeaking(prev => ({ ...prev, [playerId]: false }));
          }
        }
      }, 100);

      vadRef.current = { ctx, timer };
    } catch {
      // Sin VAD el chat funciona igual, solo se pierde el indicador.
    }
  }, [playerId]);

  const stopVAD = useCallback(() => {
    if (!vadRef.current) return;
    clearInterval(vadRef.current.timer);
    vadRef.current.ctx.close().catch(() => {});
    vadRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    stopVAD();
    peersRef.current.forEach((_, id) => destroyPeer(id));
    peersRef.current.clear();
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach(t => t.stop());
      rawStreamRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (filterCtxRef.current) {
      try {
        filterNodesRef.current.forEach(n => { if (n.stop) n.stop(); if (n.disconnect) n.disconnect(); });
        filterCtxRef.current.close().catch(() => {});
      } catch (e) {}
      filterCtxRef.current = null;
      filterNodesRef.current = [];
    }
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach(t => t.stop());
      camStreamRef.current = null;
    }
    setLocalVideo(null);
    setCamOn(false);
    setRemoteVideos({});
    setPeerStates({});
    setSpeaking({});
  }, [destroyPeer, stopVAD]);

  // --- Entrar / salir ---
  const join = useCallback(async () => {
    if (joinedRef.current || connecting) return;
    setConnecting(true);
    setError(null);
    try {
      // Precargar ICE antes de que llegue ningún peer: así createPeer es síncrona.
      await loadIceConfig();
      // El micro recordado va como "ideal": si ya no está, se coge el de por
      // defecto en vez de fallar la entrada entera.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: withDevice(MIC_CONSTRAINTS.audio, recall('mic'), false),
        video: false
      });
      rawStreamRef.current = stream;
      const filteredStream = setupVoiceFilterGraph(stream, voiceFilterRef.current);
      localStreamRef.current = filteredStream;
      joinedRef.current = true;
      setJoined(true);
      setMuted(false);
      mutedRef.current = false;
      startVAD(stream);

      // Con el permiso ya concedido, ahora los nombres de los aparatos existen.
      refreshDevices();
      const activeMic = stream.getAudioTracks()[0].getSettings().deviceId;
      if (activeMic) setSelected(s => ({ ...s, mic: activeMic }));

      socket.emit('voice_join', { roomId, playerId });
    } catch (e) {
      const T = tRef.current;
      const map = {
        NotAllowedError: T('voice.errMic'),
        NotFoundError: T('voice.errNoMic'),
        NotReadableError: T('voice.errBusyMic')
      };
      setError(map[e.name] || T('voice.errGenericMic'));
      joinedRef.current = false;
      setJoined(false);
    } finally {
      setConnecting(false);
    }
  }, [connecting, loadIceConfig, playerId, roomId, setupVoiceFilterGraph, startVAD]);

  // Re-procesar audio en caliente cuando el usuario cambia de filtro de voz
  useEffect(() => {
    if (!joinedRef.current || !rawStreamRef.current) return;

    const filteredStream = setupVoiceFilterGraph(rawStreamRef.current, voiceFilter);
    localStreamRef.current = filteredStream;
    const track = filteredStream.getAudioTracks()[0];
    if (track) {
      track.enabled = !mutedRef.current;
      peersRef.current.forEach(peer => {
        if (peer.audioSender) {
          peer.audioSender.replaceTrack(track).catch(() => {});
        }
      });
    }
  }, [voiceFilter, setupVoiceFilterGraph]);

  const leave = useCallback(() => {
    if (!joinedRef.current) return;
    socket.emit('voice_leave', { roomId, playerId });
    joinedRef.current = false;
    setJoined(false);
    teardown();
  }, [playerId, roomId, teardown]);

  // --- Cambiar de micrófono en caliente (sin renegociar ni cortar la llamada) ---
  const selectMic = useCallback(async (deviceId) => {
    if (!joinedRef.current || switching) return;
    setSwitching(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: withDevice(MIC_CONSTRAINTS.audio, deviceId, true),
        video: false
      });
      if (rawStreamRef.current) rawStreamRef.current.getTracks().forEach(t => t.stop());
      rawStreamRef.current = stream;
      const filteredStream = setupVoiceFilterGraph(stream, voiceFilterRef.current);
      localStreamRef.current = filteredStream;
      const track = filteredStream.getAudioTracks()[0];

      track.enabled = !mutedRef.current;

      await Promise.all([...peersRef.current.values()].map(peer =>
        peer.audioSender ? peer.audioSender.replaceTrack(track).catch(() => {}) : null
      ));

      stopVAD();
      startVAD(stream);

      setSelected(s => ({ ...s, mic: deviceId }));
      remember('mic', deviceId);
      refreshDevices();
    } catch (e) {
      setError(e.name === 'OverconstrainedError'
        ? tRef.current('voice.errMicGone')
        : tRef.current('voice.errMicSwitch'));
    } finally {
      setSwitching(false);
    }
  }, [refreshDevices, startVAD, stopVAD, switching]);

  // --- Cambiar de cámara en caliente ---
  const selectCam = useCallback(async (deviceId) => {
    setSelected(s => ({ ...s, cam: deviceId }));
    remember('cam', deviceId);
    // Si la cámara está apagada, basta con recordar la elección.
    if (!joinedRef.current || !camStreamRef.current || switching) return;

    setSwitching(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: withDevice(CAM_CONSTRAINTS.video, deviceId, true),
        audio: false
      });
      const track = stream.getVideoTracks()[0];
      if ('contentHint' in track) track.contentHint = 'motion';
      track.enabled = document.visibilityState === 'visible';

      await Promise.all([...peersRef.current.values()].map(async peer => {
        if (!peer.videoSender) return;
        await peer.videoSender.replaceTrack(track).catch(() => {});
        await tuneVideoSender(peer.videoSender);
      }));

      camStreamRef.current.getTracks().forEach(t => t.stop());
      camStreamRef.current = stream;
      setLocalVideo(stream);
      refreshDevices();
    } catch (e) {
      setError(e.name === 'OverconstrainedError'
        ? tRef.current('voice.errCamGone')
        : tRef.current('voice.errCamSwitch'));
    } finally {
      setSwitching(false);
    }
  }, [refreshDevices, switching]);

  // --- Cambiar de altavoz (solo donde el navegador lo permite) ---
  const selectSpeaker = useCallback(async (deviceId) => {
    speakerRef.current = deviceId;
    setSelected(s => ({ ...s, speaker: deviceId }));
    remember('speaker', deviceId);
    await Promise.all([...peersRef.current.values()].map(peer =>
      peer.audio && peer.audio.setSinkId
        ? peer.audio.setSinkId(deviceId).catch(() => {})
        : null
    ));
  }, []);

  const stopCam = useCallback(() => {
    peersRef.current.forEach(peer => {
      if (peer.videoSender) peer.videoSender.replaceTrack(null).catch(() => {});
    });
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach(t => t.stop());
      camStreamRef.current = null;
    }
    setLocalVideo(null);
    setCamOn(false);
    socket.emit('voice_cam', { on: false });
  }, []);

  // Encender/apagar cámara. NO renegocia: el transceiver ya existe desde el
  // principio y aquí solo se cambia la pista que lo alimenta.
  const toggleCam = useCallback(async () => {
    if (!joinedRef.current || camBusy) return;

    if (camOn) {
      stopCam();
      return;
    }

    setCamBusy(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: withDevice(CAM_CONSTRAINTS.video, recall('cam'), false),
        audio: false
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('sin pista de vídeo');

      // Pista al codificador: prioriza fluidez de movimiento sobre detalle fino.
      if ('contentHint' in track) track.contentHint = 'motion';

      camStreamRef.current = stream;
      setLocalVideo(stream);
      setCamOn(true);
      // Ya hay permiso de cámara: ahora sí aparecen sus nombres en la lista.
      refreshDevices();
      const activeCam = track.getSettings().deviceId;
      if (activeCam) setSelected(s => ({ ...s, cam: activeCam }));

      await Promise.all([...peersRef.current.values()].map(async peer => {
        if (!peer.videoSender) return;
        await peer.videoSender.replaceTrack(track).catch(() => {});
        await tuneVideoSender(peer.videoSender);
      }));

      socket.emit('voice_cam', { on: true });
    } catch (e) {
      const T = tRef.current;
      const map = {
        NotAllowedError: T('voice.errCam'),
        NotFoundError: T('voice.errNoCam'),
        NotReadableError: T('voice.errBusyCam')
      };
      setError(map[e.name] || T('voice.errGenericCam'));
      setCamOn(false);
    } finally {
      setCamBusy(false);
    }
  }, [camBusy, camOn, stopCam]);

  // Pestaña oculta = nadie está mirando: se corta el envío de vídeo. Es el mayor
  // ahorro de batería que hay aquí, porque para las 3 codificaciones en seco.
  useEffect(() => {
    const onVisibility = () => {
      const track = camStreamRef.current && camStreamRef.current.getVideoTracks()[0];
      if (track) track.enabled = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Silenciar sin renegociar: cortar la pista es instantáneo, mantiene viva la
  // conexión y con DTX deja de gastar ancho de banda.
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
    mutedRef.current = next; // lo lee selectMic para no des-silenciarte al cambiar
    if (next) {
      socket.emit('voice_speaking', { speaking: false });
      setSpeaking(prev => ({ ...prev, [playerId]: false }));
    }
  }, [muted, playerId]);

  // --- Señalización entrante ---
  useEffect(() => {
    function onPeers({ peers }) {
      peers.forEach(p => createPeer(p.playerId));
    }

    function onPeerJoined({ playerId: id }) {
      if (!joinedRef.current || id === playerId) return;
      createPeer(id);
    }

    function onPeerLeft({ playerId: id }) {
      destroyPeer(id);
    }

    async function onSignal({ from, data }) {
      if (!joinedRef.current) return;
      const peer = peersRef.current.get(from) || createPeer(from);
      if (!peer) return;
      const { pc } = peer;

      try {
        if (data.description) {
          const offerCollision =
            data.description.type === 'offer' &&
            (peer.makingOffer || pc.signalingState !== 'stable');

          // Si los dos ofertamos a la vez, cede el "educado".
          peer.ignoreOffer = !peer.polite && offerCollision;
          if (peer.ignoreOffer) return;

          await pc.setRemoteDescription(data.description);

          // Ya hay descripción remota: aplicar los candidatos que llegaron antes.
          if (peer.pendingCandidates.length) {
            const queued = peer.pendingCandidates;
            peer.pendingCandidates = [];
            for (const c of queued) {
              try { await pc.addIceCandidate(c); } catch { /* candidato ya inútil */ }
            }
          }

          if (data.description.type === 'offer') {
            await pc.setLocalDescription();
            const description = { ...pc.localDescription.toJSON() };
            description.sdp = tuneOpusSdp(description.sdp);
            socket.emit('voice_signal', { to: from, data: { description } });
          }
        } else if (data.candidate) {
          // Si aún no hay descripción remota, addIceCandidate lanzaría y se
          // perdería el candidato: mejor encolarlo y aplicarlo luego.
          if (!pc.remoteDescription || !pc.remoteDescription.type) {
            peer.pendingCandidates.push(data.candidate);
          } else {
            try {
              await pc.addIceCandidate(data.candidate);
            } catch (e) {
              if (!peer.ignoreOffer) throw e;
            }
          }
        }
      } catch (e) {
        console.warn('[voz] señal descartada', e);
      }
    }

    function onSpeaking({ playerId: id, speaking: sp }) {
      setSpeaking(prev => (prev[id] === sp ? prev : { ...prev, [id]: sp }));
    }

    // Si el socket se cae y vuelve, la malla anterior ya no vale: se rehace.
    function onReconnect() {
      if (!joinedRef.current) return;
      peersRef.current.forEach((_, id) => destroyPeer(id));
      peersRef.current.clear();
      socket.emit('voice_join', { roomId, playerId });
    }

    socket.on('voice_peers', onPeers);
    socket.on('voice_peer_joined', onPeerJoined);
    socket.on('voice_peer_left', onPeerLeft);
    socket.on('voice_signal', onSignal);
    socket.on('voice_speaking', onSpeaking);
    socket.on('connect', onReconnect);

    return () => {
      socket.off('voice_peers', onPeers);
      socket.off('voice_peer_joined', onPeerJoined);
      socket.off('voice_peer_left', onPeerLeft);
      socket.off('voice_signal', onSignal);
      socket.off('voice_speaking', onSpeaking);
      socket.off('connect', onReconnect);
    };
  }, [createPeer, destroyPeer, playerId, roomId]);

  // Al desmontar (salir de la sala): avisar y soltar el micro. Sin el aviso, el
  // servidor te seguiría marcando en la voz hasta que se cayera el socket.
  useEffect(() => () => {
    if (joinedRef.current) {
      socket.emit('voice_leave', { roomId, playerId });
      joinedRef.current = false;
    }
    teardown();
  }, [playerId, roomId, teardown]);

  return {
    joined, connecting, muted, error, peerStates, speaking,
    join, leave, toggleMute,
    camOn, camBusy, localVideo, remoteVideos, toggleCam,
    devices, selected, switching, selectMic, selectCam, selectSpeaker,
    canPickSpeaker: CAN_PICK_SPEAKER,
    voiceFilter, setVoiceFilter
  };
}
