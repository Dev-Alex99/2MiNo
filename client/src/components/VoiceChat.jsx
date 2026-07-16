import React, { useState } from 'react';
import { Mic, MicOff, PhoneOff, Loader2, AlertCircle, Radio, Video, VideoOff, Settings2 } from 'lucide-react';
import { useVoice } from '../voice/VoiceContext';
import VideoTile from './VideoTile';
import DeviceSelector from './DeviceSelector';

// Estado de la malla resumido para el usuario: no le interesa "ICE failed",
// le interesa si se le oye.
function connectionLabel(peerStates, players, playerId) {
  const others = players.filter(p => p.inVoice && p.id !== playerId);
  if (others.length === 0) return 'Nadie más en la voz';
  const connected = others.filter(p => peerStates[p.id] === 'connected').length;
  const failed = others.filter(p => peerStates[p.id] === 'failed').length;
  if (failed > 0 && connected === 0) return 'Sin conexión con los demás';
  if (connected < others.length) return `Conectando… (${connected}/${others.length})`;
  return `Hablando con ${connected}`;
}

export default function VoiceChat({ playerId, players }) {
  // El estado vive en el provider (App) para que la llamada sobreviva al paso
  // de la sala de espera al tablero.
  const [showDevices, setShowDevices] = useState(false);
  const voice = useVoice();
  if (!voice) return null;
  const {
    joined, connecting, muted, error, peerStates, speaking, join, leave, toggleMute,
    camOn, camBusy, localVideo, remoteVideos, toggleCam,
    devices, selected, switching, selectMic, selectCam, selectSpeaker, canPickSpeaker
  } = voice;

  const inVoice = players.filter(p => p.inVoice);

  // Quién sale en vídeo lo manda el estado del jugador (camOn), no el track:
  // al apagar la cámara el track remoto NO se marca como "muted" y se quedaría
  // el último fotograma congelado.
  const tiles = [];
  if (camOn && localVideo) {
    tiles.push({ key: playerId, stream: localVideo, name: 'Tú', isMe: true, talking: speaking[playerId], muted });
  }
  players.forEach(p => {
    if (p.id === playerId || !p.camOn) return;
    const stream = remoteVideos[p.id];
    if (!stream) return;
    tiles.push({ key: p.id, stream, name: p.name, isMe: false, talking: speaking[p.id], muted: false });
  });

  return (
    <div className="voice-panel">
      {!joined ? (
        <button
          onClick={join}
          disabled={connecting}
          className="voice-join-btn"
          title="Entrar al chat de voz"
        >
          {connecting ? <Loader2 size={15} className="voice-spin" /> : <Mic size={15} />}
          <span>{connecting ? 'Conectando…' : 'Entrar a la voz'}</span>
          {inVoice.length > 0 && (
            <span className="voice-count">{inVoice.length}</span>
          )}
        </button>
      ) : (
        <div className="voice-active">
          <button
            onClick={toggleMute}
            className={`voice-mic-btn ${muted ? 'muted' : ''} ${speaking[playerId] ? 'speaking' : ''}`}
            title={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
            aria-pressed={muted}
          >
            {muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          <div className="voice-info">
            <span className="voice-status">
              <Radio size={10} />
              {connectionLabel(peerStates, players, playerId)}
            </span>
            <div className="voice-peers">
              {inVoice.map(p => (
                <span
                  key={p.id}
                  className={`voice-peer ${speaking[p.id] ? 'talking' : ''} ${
                    p.id !== playerId && peerStates[p.id] === 'failed' ? 'failed' : ''
                  }`}
                  title={
                    p.id === playerId
                      ? 'Tú'
                      : peerStates[p.id] === 'failed'
                        ? `Sin conexión con ${p.name}`
                        : p.name
                  }
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>

          <button
            onClick={toggleCam}
            disabled={camBusy}
            className={`voice-cam-btn ${camOn ? 'on' : ''}`}
            title={camOn ? 'Apagar cámara' : 'Encender cámara'}
            aria-pressed={camOn}
          >
            {camBusy ? <Loader2 size={14} className="voice-spin" />
              : camOn ? <Video size={14} /> : <VideoOff size={14} />}
          </button>

          <button
            onClick={() => setShowDevices(v => !v)}
            className={`voice-cam-btn ${showDevices ? 'on' : ''}`}
            title="Elegir micrófono, cámara o altavoz"
            aria-expanded={showDevices}
          >
            <Settings2 size={14} />
          </button>

          <button onClick={leave} className="voice-leave-btn" title="Salir del chat de voz">
            <PhoneOff size={14} />
          </button>
        </div>
      )}

      {joined && showDevices && (
        <DeviceSelector
          devices={devices}
          selected={selected}
          switching={switching}
          camOn={camOn}
          canPickSpeaker={canPickSpeaker}
          onMic={selectMic}
          onCam={selectCam}
          onSpeaker={selectSpeaker}
        />
      )}

      {/* Miniaturas: solo de quien tiene la cámara encendida */}
      {tiles.length > 0 && (
        <div className="video-grid">
          {tiles.map(t => (
            <VideoTile
              key={t.key}
              stream={t.stream}
              name={t.name}
              isMe={t.isMe}
              talking={t.talking}
              muted={t.muted}
            />
          ))}
        </div>
      )}

      {error && (
        <div className="voice-error">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}
