import React, { useState, useEffect, useRef } from 'react';
import { useVoice } from '../voice/VoiceContext';
import {
  Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX,
  Video, VideoOff, Settings2, UserPlus, Users, X, Loader2
} from 'lucide-react';
import { socket } from '../socket';
import { getOrCreatePersistentPlayerId } from '../store/useGameStore';
import DeviceSelector from './DeviceSelector';

function VideoStreamTile({ stream, isLocal = false, label }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={`voice-video-card ${isLocal ? 'local' : 'remote'}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="voice-video-element"
      />
      <span className="voice-video-label">{label}</span>
    </div>
  );
}

export default function UnifiedVoiceWidget({ variant = 'floating' }) {
  const voice = useVoice();
  if (!voice) return null;

  const {
    roomId,
    callState,
    incomingCall,
    voicePool,
    muted,
    isMuted,
    toggleMute,
    isDeafened,
    toggleDeafen,
    acceptCall,
    declineCall,
    endCall,
    inviteFriendToPool,
    camOn,
    camBusy,
    toggleCam,
    localVideo,
    remoteVideos,
    devices,
    selected,
    switching,
    selectMic,
    selectCam,
    selectSpeaker,
    canPickSpeaker,
    voiceFilter,
    setVoiceFilter
  } = voice;

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showDevicesModal, setShowDevicesModal] = useState(false);
  const [onlineFriends, setOnlineFriends] = useState([]);
  const pid = getOrCreatePersistentPlayerId();
  const mutedActive = isMuted || muted;

  const memberCount = voicePool?.members ? voicePool.members.length : 0;
  // Consideramos activa la llamada si callState es 'connected' O si el pool tiene 2 o más miembros
  const isCallConnected = callState === 'connected' || (memberCount > 1 && callState !== 'incoming');

  useEffect(() => {
    if (showInviteModal) {
      socket.emit('get_friends', { playerId: pid });
      function onFriendsData(data) {
        if (data && data.friends) {
          setOnlineFriends(data.friends.filter(f => f.online));
        }
      }
      socket.on('friends_data', onFriendsData);
      return () => socket.off('friends_data', onFriendsData);
    }
  }, [showInviteModal, pid]);

  // 1. Modal de Llamada Entrante (Ringing)
  if (callState === 'incoming' && incomingCall) {
    return (
      <div className="unified-voice-wrapper floating">
        <div className="incoming-call-card glass-panel animate-scale-up">
          <div className="incoming-call-header">
            <div className="incoming-avatar-ring">
              <Phone className="incoming-phone-icon animate-pulse" size={22} />
            </div>
            <div className="incoming-info">
              <span className="incoming-badge">
                {incomingCall.isGroupInvite ? 'Invitación a Grupo' : 'Llamada Entrante'}
              </span>
              <h4 className="incoming-caller-name">{incomingCall.fromName}</h4>
            </div>
          </div>

          <div className="incoming-call-actions">
            <button onClick={declineCall} className="voice-action-btn btn-decline">
              <PhoneOff size={15} />
              <span>Rechazar</span>
            </button>

            <button onClick={acceptCall} className="voice-action-btn btn-accept">
              <Phone size={15} />
              <span>Aceptar</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Estado de Llamada Saliente (Llamando...)
  if (callState === 'outgoing' && !isCallConnected) {
    return (
      <div className="unified-voice-wrapper floating">
        <div className="outgoing-call-card glass-panel animate-scale-up">
          <div className="outgoing-avatar-ring">
            <Phone className="outgoing-phone-icon animate-pulse" size={18} />
          </div>

          <div className="outgoing-info">
            <span className="outgoing-title">Llamando...</span>
            <span className="outgoing-subtitle">Esperando respuesta</span>
          </div>

          <button onClick={endCall} className="voice-icon-btn btn-hangup" title="Cancelar llamada">
            <PhoneOff size={15} />
          </button>
        </div>
      </div>
    );
  }

  // 3. Omitir la barra flotante si ya estamos en una partida (donde la cabecera del juego ya integra los controles de voz)
  if (variant === 'floating' && roomId && isCallConnected) {
    return null;
  }

  // 4. Si NO hay llamada activa y estamos en modo flotante, no dibuja nada
  if (!isCallConnected && variant === 'floating') {
    return null;
  }

  // 4. Si NO hay llamada activa y estamos en modo integrado (embedded), muestra botón discreto
  if (!isCallConnected && variant === 'embedded') {
    return (
      <div className="unified-voice-embedded-idle">
        <span className="voice-idle-text">Voz disponible</span>
      </div>
    );
  }

  // 5. LLAMADA / GRUPO CONECTADO (Audio + Vídeo Cámara)
  const hasVideoStreams = camOn || Object.keys(remoteVideos || {}).length > 0;

  return (
    <div className={`unified-voice-wrapper ${variant}`}>
      {/* Rejilla de Vídeo Cámara (Si alguna cámara está encendida) */}
      {hasVideoStreams && (
        <div className="voice-video-grid animate-fade-in">
          {camOn && localVideo && (
            <VideoStreamTile stream={localVideo} isLocal label="Tú" />
          )}
          {Object.entries(remoteVideos || {}).map(([peerId, stream]) => {
            const member = (voicePool?.members || []).find(m => m.playerId === peerId);
            return (
              <VideoStreamTile
                key={peerId}
                stream={stream}
                label={member?.name || 'Amigo'}
              />
            );
          })}
        </div>
      )}

      {/* Barra de Controles de Voz & Vídeo */}
      <div className="unified-voice-bar glass-panel">
        <div className="voice-bar-status">
          <span className={`voice-status-dot ${mutedActive ? 'muted' : 'active'}`} />
          <div className="voice-status-meta">
            <span className="voice-status-title">
              {memberCount > 1 ? `Grupo (${memberCount})` : 'Llamada de Voz'}
            </span>
            <span className="voice-status-sub">
              {mutedActive ? 'Silenciado' : 'Conectado P2P'}
            </span>
          </div>
        </div>

        <div className="voice-bar-controls">
          {/* Cámara Toggle */}
          <button
            onClick={toggleCam}
            disabled={camBusy}
            className={`voice-btn ${camOn ? 'active-cam' : ''}`}
            title={camOn ? 'Apagar Cámara' : 'Encender Cámara'}
          >
            {camBusy ? <Loader2 size={15} className="voice-spin" /> : (camOn ? <Video size={15} /> : <VideoOff size={15} />)}
          </button>

          {/* Micrófono Mute */}
          <button
            onClick={toggleMute}
            className={`voice-btn ${mutedActive ? 'is-muted' : ''}`}
            title={mutedActive ? 'Activar Micrófono' : 'Silenciar Micrófono'}
          >
            {mutedActive ? <MicOff size={15} /> : <Mic size={15} />}
          </button>

          {/* Ensordecer Audio */}
          <button
            onClick={toggleDeafen}
            className={`voice-btn ${isDeafened ? 'is-muted' : ''}`}
            title={isDeafened ? 'Activar Audio' : 'Ensordecer Audio'}
          >
            {isDeafened ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>

          {/* Invitar Amigo */}
          <button
            onClick={() => {
              setShowInviteModal(!showInviteModal);
              setShowDevicesModal(false);
            }}
            className="voice-btn btn-invite"
            title="Sumar amigo a la llamada"
          >
            <UserPlus size={15} />
          </button>

          {/* Selector de Dispositivos (Ajustes) */}
          <button
            onClick={() => {
              setShowDevicesModal(!showDevicesModal);
              setShowInviteModal(false);
            }}
            className="voice-btn btn-gear"
            title="Ajustes de audio y cámara"
          >
            <Settings2 size={15} />
          </button>

          {/* Colgar / Salir */}
          <button onClick={endCall} className="voice-btn btn-hangup" title="Salir de la llamada">
            <PhoneOff size={15} />
          </button>
        </div>
      </div>

      {/* Modal Emergente de Ajustes Hardware (Aparece hacia arriba) */}
      {showDevicesModal && (
        <div className="unified-voice-settings-popover animate-scale-up">
          <div className="popover-header">
            <span className="popover-title">
              <Settings2 size={13} /> Ajustes de Llamada
            </span>
            <button onClick={() => setShowDevicesModal(false)} className="popover-close">
              <X size={13} />
            </button>
          </div>

          <DeviceSelector
            devices={devices}
            selected={selected}
            switching={switching}
            camOn={camOn}
            onMic={selectMic}
            onCam={selectCam}
            onSpeaker={selectSpeaker}
            canPickSpeaker={canPickSpeaker}
            voiceFilter={voiceFilter}
            onVoiceFilter={setVoiceFilter}
          />
        </div>
      )}

      {/* Mini Modal Emergente para Sumar Amigos (Aparece hacia arriba) */}
      {showInviteModal && (
        <div className="voice-invite-modal glass-panel animate-scale-up">
          <div className="voice-invite-header">
            <span className="voice-invite-title">
              <Users size={14} /> Sumar a la llamada
            </span>
            <button onClick={() => setShowInviteModal(false)} className="voice-invite-close">
              <X size={14} />
            </button>
          </div>

          <div className="voice-invite-list">
            {onlineFriends.length === 0 ? (
              <span className="voice-invite-empty">No hay otros amigos en línea</span>
            ) : (
              onlineFriends.map(f => (
                <div key={f.id} className="voice-invite-row">
                  <span className="voice-invite-name">{f.username}</span>
                  <button
                    onClick={() => {
                      inviteFriendToPool(f.id);
                      setShowInviteModal(false);
                    }}
                    className="voice-invite-btn"
                  >
                    Sumar
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
