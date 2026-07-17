import React, { useState } from 'react';
import { Mic, MicOff, PhoneOff, Loader2, AlertCircle, Radio, Video, VideoOff, Settings2, X } from 'lucide-react';
import { useVoice } from '../voice/VoiceContext';
import { useT } from '../i18n/LanguageContext';
import DeviceSelector from './DeviceSelector';

// Estado de la malla resumido para el usuario: no le interesa "ICE failed",
// le interesa si se le oye.
function connectionLabel(peerStates, players, playerId, t) {
  const others = players.filter(p => p.inVoice && p.id !== playerId);
  if (others.length === 0) return t('voice.nobody');
  const connected = others.filter(p => peerStates[p.id] === 'connected').length;
  const failed = others.filter(p => peerStates[p.id] === 'failed').length;
  if (failed > 0 && connected === 0) return t('voice.noConn');
  if (connected < others.length) return t('voice.connectingN', { a: connected, b: others.length });
  return t('voice.talkingWith', { n: connected });
}

export default function VoiceChat({ playerId, players, nudge = false }) {
  const { t } = useT();
  // El estado vive en el provider (App) para que la llamada sobreviva al paso
  // de la sala de espera al tablero.
  const [showDevices, setShowDevices] = useState(false);
  // Burbuja que invita a entrar a la voz. Se descarta al pulsarla o al unirse.
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const voice = useVoice();
  if (!voice) return null;
  const {
    joined, connecting, muted, error, peerStates, speaking, join, leave, toggleMute,
    camOn, camBusy, toggleCam,
    devices, selected, switching, selectMic, selectCam, selectSpeaker, canPickSpeaker
  } = voice;

  const inVoice = players.filter(p => p.inVoice);

  const showNudge = nudge && !joined && !connecting && !nudgeDismissed;

  return (
    <div className="voice-panel">
      {!joined ? (
        <div className="voice-join-wrap">
          {showNudge && (
            <div className="voice-nudge" role="status">
              <span className="voice-nudge-icon">🎙️</span>
              <span>
                {inVoice.length > 0
                  ? t('voice.nudgeSome', { n: inVoice.length })
                  : t('voice.nudge')}
              </span>
              <button
                className="voice-nudge-close"
                onClick={() => setNudgeDismissed(true)}
                aria-label={t('common.cancel')}
              >
                <X size={12} />
              </button>
            </div>
          )}
          <button
            onClick={join}
            disabled={connecting}
            className={`voice-join-btn ${showNudge ? 'inviting' : ''}`}
            title={t('voice.join')}
          >
            {connecting ? <Loader2 size={15} className="voice-spin" /> : <Mic size={15} />}
            {/* Etiqueta completa donde hay sitio (sala de espera, nudge=true);
                corta en la barra de partida. */}
            <span>{connecting ? t('voice.connecting') : (nudge ? t('voice.join') : t('voice.short'))}</span>
            {inVoice.length > 0 && (
              <span className="voice-count">{inVoice.length}</span>
            )}
          </button>
        </div>
      ) : (
        <div className="voice-active">
          <button
            onClick={toggleMute}
            className={`voice-mic-btn ${muted ? 'muted' : ''} ${speaking[playerId] ? 'speaking' : ''}`}
            title={muted ? t('voice.unmute') : t('voice.mute')}
            aria-pressed={muted}
          >
            {muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          <div className="voice-info">
            <span className="voice-status">
              <Radio size={10} />
              {connectionLabel(peerStates, players, playerId, t)}
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
                      ? t('common.you')
                      : peerStates[p.id] === 'failed'
                        ? t('voice.noConn')
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
            title={camOn ? t('voice.camOff') : t('voice.camOn')}
            aria-pressed={camOn}
          >
            {camBusy ? <Loader2 size={14} className="voice-spin" />
              : camOn ? <Video size={14} /> : <VideoOff size={14} />}
          </button>

          <button
            onClick={() => setShowDevices(v => !v)}
            className={`voice-cam-btn ${showDevices ? 'on' : ''}`}
            title={t('voice.settings')}
            aria-expanded={showDevices}
          >
            <Settings2 size={14} />
          </button>

          <button onClick={leave} className="voice-leave-btn" title={t('voice.leave')}>
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

      {/* Las miniaturas NO van aquí: flotan sobre el tablero (VideoGrid), para
          no robarle altura en móvil. */}

      {error && (
        <div className="voice-error">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}
