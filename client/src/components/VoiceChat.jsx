import React from 'react';
import UnifiedVoiceWidget from './UnifiedVoiceWidget';

export default function VoiceChat({ playerId, players = [], nudge = false }) {
  return <UnifiedVoiceWidget variant="embedded" />;
}
