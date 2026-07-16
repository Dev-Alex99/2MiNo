import React, { createContext, useContext } from 'react';
import useVoiceChat from '../hooks/useVoiceChat';

/**
 * El estado de la voz vive aquí arriba, por encima de la sala de espera y del
 * tablero. Si el panel montara el hook en cada pantalla, pasar de "esperando" a
 * "jugando" lo desmontaría y cortaría la llamada justo al empezar la partida.
 */
const VoiceContext = createContext(null);

export function VoiceProvider({ roomId, playerId, children }) {
  const voice = useVoiceChat({ roomId, playerId });
  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  return useContext(VoiceContext);
}
