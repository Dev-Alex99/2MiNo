import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';

const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
};

const CAN_PICK_SPEAKER = typeof document !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype;

function recall(key) {
  try { return localStorage.getItem(`domino_voice_${key}`) || ''; } catch { return ''; }
}

function store(key, val) {
  try { localStorage.setItem(`domino_voice_${key}`, val); } catch { /* noop */ }
}

function withDevice(constraints, deviceId, isVideo = false) {
  if (!deviceId) return constraints;
  const target = isVideo ? 'video' : 'audio';
  const curr = constraints[target];
  if (typeof curr === 'object' && curr !== null) {
    return { ...constraints, [target]: { ...curr, deviceId: { exact: deviceId } } };
  }
  return { ...constraints, [target]: { deviceId: { exact: deviceId } } };
}

// OJO: `name` debe desestructurarse. Si falta, dentro del hook `name` resuelve
// al global `window.name` (el nombre de la ventana, casi siempre ''), y el
// nombre solo "funcionaba" por el respaldo a localStorage.
export default function useVoiceChat({ roomId, playerId, name }) {
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;

  // Estados de Voz y Cámara Video
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);
  const [peerStates, setPeerStates] = useState({});
  const [speaking, setSpeaking] = useState({});
  const [camOn, setCamOn] = useState(false);
  const [camBusy, setCamBusy] = useState(false);
  const [localVideo, setLocalVideo] = useState(null);
  const [remoteVideos, setRemoteVideos] = useState({});
  const [devices, setDevices] = useState({ mics: [], cams: [], speakers: [] });
  const [selected, setSelected] = useState({
    mic: recall('mic'), cam: recall('cam'), speaker: recall('speaker')
  });
  const [switching, setSwitching] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState('normal');

  // --- ESTADO DE GLOBAL VOICE POOLS (Llamadas Multijugador Desvinculadas) ---
  const [callState, setCallState] = useState('idle'); // 'idle' | 'outgoing' | 'incoming' | 'connected'
  const [incomingCall, setIncomingCall] = useState(null); // { callId, poolId, fromPlayerId, fromName, isGroupInvite }
  const [voicePool, setVoicePool] = useState({ poolId: null, members: [] });
  const [isDeafened, setIsDeafened] = useState(false);

  const voicePoolRef = useRef({ poolId: null, members: [] });
  voicePoolRef.current = voicePool;

  const poolPeersRef = useRef(new Map()); // peerPlayerId -> { pc, audio, pendingCandidates, makingOffer, ignoreOffer, polite }
  const mutedRef = useRef(false);
  const speakerRef = useRef(recall('speaker'));

  const localStreamRef = useRef(null);
  const rawStreamRef = useRef(null);
  const camStreamRef = useRef(null);
  const iceConfigRef = useRef(null);

  // Cargar Servidores ICE STUN
  const loadIceConfig = useCallback(async () => {
    if (iceConfigRef.current) return iceConfigRef.current;
    try {
      const res = await fetch('/api/turn-credentials');
      if (res.ok) {
        const data = await res.json();
        if (data && data.iceServers) {
          iceConfigRef.current = { iceServers: data.iceServers };
          return iceConfigRef.current;
        }
      }
    } catch { /* fallback a STUN público */ }
    iceConfigRef.current = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    return iceConfigRef.current;
  }, []);

  // Enumerar Dispositivos de Audio y Vídeo
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devList = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        mics: devList.filter(d => d.kind === 'audioinput'),
        cams: devList.filter(d => d.kind === 'videoinput'),
        speakers: devList.filter(d => d.kind === 'audiooutput')
      });
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // Garantizar Microfonía Activa
  const ensureMicStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      await loadIceConfig();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: withDevice(MIC_CONSTRAINTS.audio, recall('mic'), false),
        video: false
      });
      rawStreamRef.current = stream;
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach(t => { t.enabled = !mutedRef.current; });
      refreshDevices();
      return stream;
    } catch (e) {
      console.warn('[voz global] Error accediendo al micrófono:', e);
      return null;
    }
  }, [loadIceConfig, refreshDevices]);

  // Destruir Peer de Pool
  const destroyPoolPeer = useCallback((peerPlayerId) => {
    const peer = poolPeersRef.current.get(peerPlayerId);
    if (!peer) return;
    try {
      if (peer.audio) {
        peer.audio.pause();
        peer.audio.srcObject = null;
        peer.audio.remove();
      }
      if (peer.pc) peer.pc.close();
    } catch { /* noop */ }
    poolPeersRef.current.delete(peerPlayerId);
    setRemoteVideos(prev => {
      if (!prev[peerPlayerId]) return prev;
      const next = { ...prev };
      delete next[peerPlayerId];
      return next;
    });
  }, []);

  // Crear Peer de Pool con Negociación Perfecta (Anti-Glare / Anti-InvalidStateError)
  const createPoolPeer = useCallback(async (targetPlayerId, isInitiator) => {
    if (poolPeersRef.current.has(targetPlayerId)) {
      return poolPeersRef.current.get(targetPlayerId);
    }

    const iceConfig = await loadIceConfig();
    const stream = await ensureMicStream();

    const pc = new RTCPeerConnection(iceConfig);
    const polite = playerId < targetPlayerId;
    const peerData = {
      pc,
      audio: null,
      pendingCandidates: [],
      makingOffer: false,
      ignoreOffer: false,
      polite
    };
    poolPeersRef.current.set(targetPlayerId, peerData);

    if (stream) {
      stream.getTracks().forEach(track => {
        track.enabled = !mutedRef.current;
        pc.addTrack(track, stream);
      });
    }

    // Si la cámara ya está activa, agregar la pista de vídeo
    if (camStreamRef.current) {
      const vTrack = camStreamRef.current.getVideoTracks()[0];
      if (vTrack) pc.addTrack(vTrack, camStreamRef.current);
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && voicePoolRef.current.poolId) {
        socket.emit('voice_pool_signal', {
          poolId: voicePoolRef.current.poolId,
          toPlayerId: targetPlayerId,
          signal: { candidate }
        });
      }
    };

    pc.ontrack = ({ track, streams }) => {
      if (track.kind === 'audio') {
        let audio = peerData.audio;
        if (!audio) {
          audio = document.createElement('audio');
          audio.autoplay = true;
          audio.setAttribute('playsinline', '');
          audio.style.display = 'none';
          document.body.appendChild(audio);
          if (speakerRef.current && audio.setSinkId) {
            audio.setSinkId(speakerRef.current).catch(() => {});
          }
          peerData.audio = audio;
        }
        audio.muted = isDeafened;
        audio.srcObject = streams[0] || new MediaStream([track]);
        audio.play().catch(e => console.warn('[voz audio play error]', e));
      } else if (track.kind === 'video') {
        const vStream = streams[0] || new MediaStream([track]);
        setRemoteVideos(prev => ({ ...prev, [targetPlayerId]: vStream }));
        track.onended = () => {
          setRemoteVideos(prev => {
            const next = { ...prev };
            delete next[targetPlayerId];
            return next;
          });
        };
      }
    };

    if (isInitiator) {
      try {
        peerData.makingOffer = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice_pool_signal', {
          poolId: voicePoolRef.current.poolId,
          toPlayerId: targetPlayerId,
          signal: { description: pc.localDescription }
        });
      } catch (e) {
        console.warn('[voz offer error]', e);
      } finally {
        peerData.makingOffer = false;
      }
    }

    return peerData;
  }, [ensureMicStream, isDeafened, loadIceConfig, playerId]);

  // Alternar Silencio de Micrófono
  const toggleMute = useCallback(() => {
    setMuted(prevMuted => {
      const nextMuted = !prevMuted;
      mutedRef.current = nextMuted;

      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !nextMuted; });
      }
      if (rawStreamRef.current) {
        rawStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !nextMuted; });
      }

      poolPeersRef.current.forEach(({ pc }) => {
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = !nextMuted;
          }
        });
      });

      if (voicePoolRef.current.poolId) {
        socket.emit('voice_pool_speaking', { poolId: voicePoolRef.current.poolId, speaking: !nextMuted });
      }
      return nextMuted;
    });
  }, []);

  // Alternar Cámara de Vídeo (Video Toggle)
  const toggleCam = useCallback(async () => {
    if (camBusy) return;
    setCamBusy(true);
    try {
      if (camOn) {
        if (camStreamRef.current) {
          camStreamRef.current.getTracks().forEach(t => t.stop());
          camStreamRef.current = null;
        }
        setLocalVideo(null);
        setCamOn(false);
        poolPeersRef.current.forEach(({ pc }) => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) pc.removeTrack(sender);
        });
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: withDevice({ width: { ideal: 640 }, height: { ideal: 480 } }, recall('cam'), true)
        });
        camStreamRef.current = stream;
        setLocalVideo(stream);
        setCamOn(true);
        const vTrack = stream.getVideoTracks()[0];
        poolPeersRef.current.forEach(({ pc }) => {
          pc.addTrack(vTrack, stream);
        });
      }
    } catch (e) {
      console.warn('[voz cam error]', e);
    } finally {
      setCamBusy(false);
    }
  }, [camBusy, camOn]);

  const toggleDeafen = useCallback(() => {
    setIsDeafened(prev => {
      const next = !prev;
      poolPeersRef.current.forEach(peer => {
        if (peer.audio) peer.audio.muted = next;
      });
      return next;
    });
  }, []);

  // Selección de Dispositivos (Micrófono, Cámara, Altavoz)
  const selectMic = useCallback(async (deviceId) => {
    setSelected(s => ({ ...s, mic: deviceId }));
    store('mic', deviceId);
    if (!localStreamRef.current) return;
    try {
      setSwitching(true);
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: withDevice(MIC_CONSTRAINTS.audio, deviceId, false)
      });
      rawStreamRef.current = newStream;
      localStreamRef.current = newStream;
      const audioTrack = newStream.getAudioTracks()[0];
      poolPeersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(audioTrack);
      });
    } catch (e) {
      console.warn('[voz selectMic error]', e);
    } finally {
      setSwitching(false);
    }
  }, []);

  const selectCam = useCallback(async (deviceId) => {
    setSelected(s => ({ ...s, cam: deviceId }));
    store('cam', deviceId);
    if (!camOn) return;
    try {
      setSwitching(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: withDevice({ width: { ideal: 640 }, height: { ideal: 480 } }, deviceId, true)
      });
      if (camStreamRef.current) camStreamRef.current.getTracks().forEach(t => t.stop());
      camStreamRef.current = stream;
      setLocalVideo(stream);
      const vTrack = stream.getVideoTracks()[0];
      poolPeersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(vTrack);
      });
    } catch (e) {
      console.warn('[voz selectCam error]', e);
    } finally {
      setSwitching(false);
    }
  }, [camOn]);

  const selectSpeaker = useCallback(async (deviceId) => {
    setSelected(s => ({ ...s, speaker: deviceId }));
    store('speaker', deviceId);
    speakerRef.current = deviceId;
    poolPeersRef.current.forEach(peer => {
      if (peer.audio && peer.audio.setSinkId) {
        peer.audio.setSinkId(deviceId).catch(() => {});
      }
    });
  }, []);

  const callFriend = useCallback(async (targetPlayerId, callerName) => {
    setCallState('outgoing');
    await ensureMicStream();
    socket.emit('call_friend', { targetPlayerId, callerName, callerId: playerId });
  }, [ensureMicStream, playerId]);

  const inviteFriendToPool = useCallback((targetPlayerId, myName) => {
    if (!voicePool.poolId) return;
    socket.emit('invite_to_pool', {
      poolId: voicePool.poolId,
      targetPlayerId,
      inviterName: myName || 'Jugador',
      inviterId: playerId
    });
  }, [playerId, voicePool.poolId]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    setCallState('connected');
    await ensureMicStream();
    const actualName = name || localStorage.getItem('domino_username') || 'Jugador';
    socket.emit('accept_call', {
      callId: incomingCall.callId,
      poolId: incomingCall.poolId,
      playerId,
      name: actualName
    });
    setIncomingCall(null);
  }, [ensureMicStream, incomingCall, name, playerId]);

  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    socket.emit('decline_call', { callId: incomingCall.callId });
    setIncomingCall(null);
    setCallState('idle');
  }, [incomingCall]);

  const endCall = useCallback(() => {
    if (voicePool.poolId) {
      socket.emit('end_call', { poolId: voicePool.poolId, playerId });
    }
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach(t => t.stop());
      camStreamRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach(t => t.stop());
      rawStreamRef.current = null;
    }
    setLocalVideo(null);
    setCamOn(false);
    poolPeersRef.current.forEach((_, pId) => destroyPoolPeer(pId));
    poolPeersRef.current.clear();
    setIncomingCall(null);
    setCallState('idle');
    setVoicePool({ poolId: null, members: [] });
  }, [destroyPoolPeer, playerId, voicePool.poolId]);

  // Listeners de Socket.io
  useEffect(() => {
    function onIncomingCall(data) {
      setIncomingCall(data);
      setCallState('incoming');
    }

    function onCallOutgoing() {
      setCallState('outgoing');
    }

    function onCallAccepted(data) {
      setCallState('connected');
      if (data && data.poolId) {
        setVoicePool(prev => ({ ...prev, poolId: data.poolId }));
      }
    }

    function onVoicePoolJoined(data) {
      setCallState('connected');
      setVoicePool({ poolId: data.poolId, members: data.members || [] });
    }

    function onVoicePoolUpdated(data) {
      setVoicePool({ poolId: data.poolId, members: data.members || [] });
      if (data.members && data.members.length > 1) {
        setCallState('connected');
      }

      // Iniciar oferta solo si nuestra ID es menor que la del target para evitar colisiones
      (data.members || []).forEach(m => {
        if (m.playerId !== playerId && !poolPeersRef.current.has(m.playerId)) {
          const isInitiator = playerId < m.playerId;
          createPoolPeer(m.playerId, isInitiator);
        }
      });

      const activeMemberIds = new Set((data.members || []).map(m => m.playerId));
      poolPeersRef.current.forEach((_, pId) => {
        if (!activeMemberIds.has(pId)) {
          destroyPoolPeer(pId);
        }
      });
    }

    async function onVoicePoolSignal(data) {
      const { fromPlayerId, signal } = data;
      if (!fromPlayerId) return;

      let peerData = poolPeersRef.current.get(fromPlayerId);
      if (!peerData) {
        peerData = await createPoolPeer(fromPlayerId, false);
      }

      const { pc, polite } = peerData;
      try {
        if (signal.description) {
          const { description } = signal;
          const offerCollision = (description.type === 'offer') &&
            (peerData.makingOffer || pc.signalingState !== 'stable');

          peerData.ignoreOffer = !polite && offerCollision;
          if (peerData.ignoreOffer) return;

          if (description.type === 'answer' && pc.signalingState !== 'have-local-offer') {
            return;
          }

          await pc.setRemoteDescription(description);

          if (peerData.pendingCandidates.length) {
            for (const candidate of peerData.pendingCandidates) {
              try { await pc.addIceCandidate(candidate); } catch {}
            }
            peerData.pendingCandidates = [];
          }

          if (description.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('voice_pool_signal', {
              poolId: voicePoolRef.current.poolId,
              toPlayerId: fromPlayerId,
              signal: { description: pc.localDescription }
            });
          }
        } else if (signal.candidate) {
          if (!pc.remoteDescription || !pc.remoteDescription.type) {
            peerData.pendingCandidates.push(signal.candidate);
          } else {
            try { await pc.addIceCandidate(signal.candidate); } catch {}
          }
        }
      } catch (e) {
        console.warn('[voz pool signal error]', e);
      }
    }

    function onCallDeclined() {
      setCallState('idle');
      setIncomingCall(null);
    }

    function onCallTimeout() {
      setCallState('idle');
      setIncomingCall(null);
    }

    socket.on('incoming_call', onIncomingCall);
    socket.on('call_outgoing', onCallOutgoing);
    socket.on('call_accepted', onCallAccepted);
    socket.on('voice_pool_joined', onVoicePoolJoined);
    socket.on('voice_pool_updated', onVoicePoolUpdated);
    socket.on('voice_pool_signal', onVoicePoolSignal);
    socket.on('call_declined', onCallDeclined);
    socket.on('call_timeout', onCallTimeout);

    return () => {
      socket.off('incoming_call', onIncomingCall);
      socket.off('call_outgoing', onCallOutgoing);
      socket.off('call_accepted', onCallAccepted);
      socket.off('voice_pool_joined', onVoicePoolJoined);
      socket.off('voice_pool_updated', onVoicePoolUpdated);
      socket.off('voice_pool_signal', onVoicePoolSignal);
      socket.off('call_declined', onCallDeclined);
      socket.off('call_timeout', onCallTimeout);
    };
  }, [createPoolPeer, destroyPoolPeer, playerId]);

  return {
    joined, connecting, muted, isMuted: muted, error, peerStates, speaking,
    toggleMute,
    camOn, camBusy, localVideo, remoteVideos, toggleCam,
    devices, selected, switching, selectMic, selectCam, selectSpeaker,
    canPickSpeaker: CAN_PICK_SPEAKER,
    voiceFilter, setVoiceFilter,
    // Métodos y estado de llamadas a amigos & pools
    roomId, callState, incomingCall, voicePool, isDeafened, toggleDeafen,
    callFriend, inviteFriendToPool, acceptCall, declineCall, endCall
  };
}
