import { useCallback, useEffect, useRef, useState } from 'react';
import { socket, serverUrl } from '../socket';

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

export default function useVoiceChat({ roomId, playerId }) {
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);
  // playerId -> 'connecting' | 'connected' | 'failed'
  const [peerStates, setPeerStates] = useState({});
  const [speaking, setSpeaking] = useState({});

  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const iceConfigRef = useRef(null);
  const joinedRef = useRef(false);
  const vadRef = useRef(null);

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

  const setPeerState = useCallback((id, state) => {
    setPeerStates(prev => (prev[id] === state ? prev : { ...prev, [id]: state }));
  }, []);

  const destroyPeer = useCallback((id) => {
    const peer = peersRef.current.get(id);
    if (!peer) return;
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
      restarts: 0
    };
    peersRef.current.set(peerId, peer); // síncrono: sin ventana para duplicados
    setPeerState(peerId, 'connecting');

    const stream = localStreamRef.current;
    if (stream) stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));

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

    pc.ontrack = ({ streams }) => {
      if (!peer.audio) {
        // En el DOM (oculto): iOS Safari es poco fiable con elementos sueltos.
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.setAttribute('playsinline', '');
        audio.style.display = 'none';
        document.body.appendChild(audio);
        peer.audio = audio;
      }
      peer.audio.srcObject = streams[0];
      // El gesto de pulsar "Entrar a la voz" nos habilita el autoplay.
      peer.audio.play().catch(() => {});
    };

    // --- Robustez: recuperar la conexión cuando la red se cae ---
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        peer.restarts = 0;
        setPeerState(peerId, 'connected');
        capBitrate();
      } else if (st === 'new' || st === 'connecting') {
        setPeerState(peerId, 'connecting');
      } else if (st === 'disconnected') {
        // Suele ser transitorio: se le da margen antes de actuar.
        setPeerState(peerId, 'connecting');
      } else if (st === 'failed') {
        setPeerState(peerId, 'failed');
        if (peer.restarts < MAX_ICE_RESTARTS) {
          peer.restarts++;
          setTimeout(() => {
            // Si el peer se destruyó o se recreó mientras tanto, no tocar nada.
            if (peersRef.current.get(peerId) !== peer) return;
            try { pc.restartIce(); } catch { /* navegador antiguo */ }
          }, 500 * peer.restarts);
        }
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
    if (localStreamRef.current) {
      // Soltar el micro: si no, el piloto del navegador se queda encendido.
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
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
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      localStreamRef.current = stream;
      joinedRef.current = true;
      setJoined(true);
      setMuted(false);
      startVAD(stream);
      socket.emit('voice_join', { roomId, playerId });
    } catch (e) {
      const map = {
        NotAllowedError: 'Has bloqueado el micrófono. Permítelo desde el candado de la barra de direcciones.',
        NotFoundError: 'No se ha encontrado ningún micrófono conectado.',
        NotReadableError: 'Otra aplicación está usando el micrófono.'
      };
      setError(map[e.name] || 'No se pudo acceder al micrófono.');
      joinedRef.current = false;
      setJoined(false);
    } finally {
      setConnecting(false);
    }
  }, [connecting, loadIceConfig, playerId, roomId, startVAD]);

  const leave = useCallback(() => {
    if (!joinedRef.current) return;
    socket.emit('voice_leave', { roomId, playerId });
    joinedRef.current = false;
    setJoined(false);
    teardown();
  }, [playerId, roomId, teardown]);

  // Silenciar sin renegociar: cortar la pista es instantáneo, mantiene viva la
  // conexión y con DTX deja de gastar ancho de banda.
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
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
          if (data.description.type === 'offer') {
            await pc.setLocalDescription();
            const description = { ...pc.localDescription.toJSON() };
            description.sdp = tuneOpusSdp(description.sdp);
            socket.emit('voice_signal', { to: from, data: { description } });
          }
        } else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (e) {
            if (!peer.ignoreOffer) throw e;
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

  return { joined, connecting, muted, error, peerStates, speaking, join, leave, toggleMute };
}
