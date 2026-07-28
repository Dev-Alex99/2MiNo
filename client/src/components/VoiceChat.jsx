import React from 'react';
import UnifiedVoiceWidget from './UnifiedVoiceWidget';

/**
 * Envoltorio delgado: monta el widget de voz en su variante integrada.
 *
 * Recibía `playerId`, `players` y `nudge` y no usaba ninguno — el widget saca
 * todo del contexto de voz. Se han quitado de la firma para que no parezca que
 * hacen algo; quien lo renderiza puede seguir pasándolos sin efecto.
 */
export default function VoiceChat() {
  return <UnifiedVoiceWidget variant="embedded" />;
}
