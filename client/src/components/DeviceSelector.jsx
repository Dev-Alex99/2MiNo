import React from 'react';
import { Mic, Video, Volume2 } from 'lucide-react';

// Los nombres de los aparatos llegan vacíos hasta que hay permiso concedido.
// Antes de eso el navegador solo da un id, así que ponemos una etiqueta útil.
function labelFor(device, index, fallback) {
  if (device.label) return device.label;
  return `${fallback} ${index + 1}`;
}

function Row({ icon, title, devices, value, onChange, disabled, hint }) {
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
        {!value && <option value="">Predeterminado</option>}
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
  const nothing =
    devices.mics.length <= 1 && devices.cams.length <= 1 && devices.speakers.length <= 1;

  return (
    <div className="device-panel">
      <Row
        icon={<Mic size={11} />}
        title="Micrófono"
        devices={devices.mics}
        value={selected.mic}
        onChange={onMic}
        disabled={switching}
        hint="Micrófono"
      />
      <Row
        icon={<Video size={11} />}
        title="Cámara"
        devices={devices.cams}
        value={selected.cam}
        onChange={onCam}
        disabled={switching}
        hint="Cámara"
      />
      {canPickSpeaker && (
        <Row
          icon={<Volume2 size={11} />}
          title="Altavoz"
          devices={devices.speakers}
          value={selected.speaker}
          onChange={onSpeaker}
          disabled={switching}
          hint="Altavoz"
        />
      )}

      {devices.cams.length > 0 && !camOn && (
        <span className="device-note">
          Los nombres de las cámaras aparecen al encenderla por primera vez.
        </span>
      )}
      {nothing && (
        <span className="device-note">Solo se ha detectado un dispositivo de cada tipo.</span>
      )}
    </div>
  );
}
