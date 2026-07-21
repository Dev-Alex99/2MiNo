import React from 'react';
import { Mic, Video, Volume2 } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

// Los nombres de los aparatos llegan vacíos hasta que hay permiso concedido.
// Antes de eso el navegador solo da un id, así que ponemos una etiqueta útil.
function labelFor(device, index, fallback) {
  if (device.label) return device.label;
  return `${fallback} ${index + 1}`;
}

function Row({ icon, title, devices, value, onChange, disabled, hint, defaultLabel }) {
  if (devices.length === 0) return null;
  return (
    <label className="device-row">
      <span className="device-label">
        {icon}
        {title}
      </span>
      <select
        className="device-select"
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {!value && <option value="">{defaultLabel}</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {labelFor(d, i, hint)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function DeviceSelector({
  devices, selected, switching, camOn,
  onMic, onCam, onSpeaker, canPickSpeaker,
  voiceFilter, onVoiceFilter
}) {
  const { t } = useT();
  const nothing =
    devices.mics.length <= 1 && devices.cams.length <= 1 && devices.speakers.length <= 1;

  return (
    <div className="device-panel">
      {/* Selector de Filtros de Voz */}
      <div className="device-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
        <span className="device-label" style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700 }}>
          🎤 Filtro de Voz FX
        </span>
        <div className="voice-filter-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', width: '100%' }}>
          <button
            type="button"
            onClick={() => onVoiceFilter && onVoiceFilter('normal')}
            className={`voice-filter-btn ${voiceFilter === 'normal' ? 'active' : ''}`}
            title="Voz Normal"
            style={{ textAlign: 'center', padding: '4px 2px', fontSize: '0.7rem' }}
          >
            🎤 Normal
          </button>
          <button
            type="button"
            onClick={() => onVoiceFilter && onVoiceFilter('megaphone')}
            className={`voice-filter-btn ${voiceFilter === 'megaphone' ? 'active' : ''}`}
            title="Filtro Megáfono / Anunciador"
            style={{ textAlign: 'center', padding: '4px 2px', fontSize: '0.7rem' }}
          >
            📢 Megáfono
          </button>
          <button
            type="button"
            onClick={() => onVoiceFilter && onVoiceFilter('robot')}
            className={`voice-filter-btn ${voiceFilter === 'robot' ? 'active' : ''}`}
            title="Filtro Robot Cyborg"
            style={{ textAlign: 'center', padding: '4px 2px', fontSize: '0.7rem' }}
          >
            🤖 Robot
          </button>
          <button
            type="button"
            onClick={() => onVoiceFilter && onVoiceFilter('alien')}
            className={`voice-filter-btn ${voiceFilter === 'alien' ? 'active' : ''}`}
            title="Filtro Alienígena"
            style={{ textAlign: 'center', padding: '4px 2px', fontSize: '0.7rem' }}
          >
            👾 Alien
          </button>
          <button
            type="button"
            onClick={() => onVoiceFilter && onVoiceFilter('monster')}
            className={`voice-filter-btn ${voiceFilter === 'monster' ? 'active' : ''}`}
            title="Filtro Monstruo Ogro"
            style={{ textAlign: 'center', padding: '4px 2px', fontSize: '0.7rem' }}
          >
            👹 Monstruo
          </button>
          <button
            type="button"
            onClick={() => onVoiceFilter && onVoiceFilter('radio')}
            className={`voice-filter-btn ${voiceFilter === 'radio' ? 'active' : ''}`}
            title="Filtro Walkie-Talkie Piloto"
            style={{ textAlign: 'center', padding: '4px 2px', fontSize: '0.7rem' }}
          >
            📻 Radio
          </button>
        </div>
      </div>

      <Row
        icon={<Mic size={11} />}
        title={t('dev.mic')}
        devices={devices.mics}
        value={selected.mic}
        onChange={onMic}
        disabled={switching}
        hint={t('dev.mic')}
        defaultLabel={t('dev.default')}
      />
      <Row
        icon={<Video size={11} />}
        title={t('dev.cam')}
        devices={devices.cams}
        value={selected.cam}
        onChange={onCam}
        disabled={switching}
        hint={t('dev.cam')}
        defaultLabel={t('dev.default')}
      />
      {canPickSpeaker && (
        <Row
          icon={<Volume2 size={11} />}
          title={t('dev.speaker')}
          devices={devices.speakers}
          value={selected.speaker}
          onChange={onSpeaker}
          disabled={switching}
          hint={t('dev.speaker')}
          defaultLabel={t('dev.default')}
        />
      )}

      {devices.cams.length > 0 && !camOn && (
        <span className="device-note">{t('dev.camHint')}</span>
      )}
      {nothing && (
        <span className="device-note">{t('dev.onlyOne')}</span>
      )}
    </div>
  );
}
