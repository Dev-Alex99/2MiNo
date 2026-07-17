import React from 'react';
import { useVoice } from '../voice/VoiceContext';
import VideoTile from './VideoTile';

/**
 * Miniaturas flotando SOBRE el tablero.
 *
 * Vivían dentro de la barra lateral, y ahí ocupaban espacio real: en móvil la
 * barra crece hacia abajo y se comía la altura del tablero (que son ~135px),
 * dejándote viendo caras y ningún dominó. Aquí van en posición absoluta, fuera
 * del flujo: por muchas cámaras que haya, el tablero no pierde ni un píxel.
 */
// selfOnly: en móvil los rivales salen en su asiento alrededor del tablero, así
// que aquí solo queda tu propia vista previa.
export default function VideoGrid({ players, playerId, selfOnly = false }) {
  const voice = useVoice();
  if (!voice) return null;
  const { camOn, localVideo, remoteVideos, speaking, muted } = voice;

  const tiles = [];
  if (camOn && localVideo) {
    tiles.push({ key: playerId, stream: localVideo, name: 'Tú', isMe: true, talking: speaking[playerId], muted });
  }
  if (!selfOnly) {
    players.forEach(p => {
      if (p.id === playerId || !p.camOn) return;
      const stream = remoteVideos[p.id];
      if (!stream) return;
      tiles.push({ key: p.id, stream, name: p.name, isMe: false, talking: speaking[p.id], muted: false });
    });
  }

  if (tiles.length === 0) return null;

  return (
    // pointer-events: none en CSS => no roba el arrastre del tablero.
    <div className="video-float">
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
  );
}
