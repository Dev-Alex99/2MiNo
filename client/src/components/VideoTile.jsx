import React, { useEffect, useRef } from 'react';
import { MicOff } from 'lucide-react';

/**
 * Miniatura de vídeo de un jugador. El <video> se alimenta por srcObject (no por
 * estado de React) para que un cambio de stream no fuerce a recrear el elemento.
 */
export default function VideoTile({ stream, name, isMe, talking, muted }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);

  return (
    <div className={`video-tile ${talking ? 'talking' : ''}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        // El propio vídeo va silenciado siempre: el audio llega por su
        // conexión de voz. Si no, te oirías a ti mismo con eco.
        muted
      />
      <span className="video-tile-name">
        {muted && <MicOff size={9} />}
        {isMe ? 'Tú' : name}
      </span>
    </div>
  );
}
