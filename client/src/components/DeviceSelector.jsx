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
  onMic, onCam, onSpeaker, canPickSpeaker
}) {
  const { t } = useT();
  const nothing =
    devices.mics.length <= 1 && devices.cams.length <= 1 && devices.speakers.length <= 1;

  return (
    <div className="device-panel">
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
