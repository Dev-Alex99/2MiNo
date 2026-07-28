import React, { createContext, useContext } from 'react';
import useVoiceChat from '../hooks/useVoiceChat';

/**
 * El estado de la voz vive aquí arriba, por encima de la sala de espera y del
 * tablero. Si el panel montara el hook en cada pantalla, pasar de "esperando" a
 * "jugando" lo desmontaría y cortaría la llamada justo al empezar la partida.
 */
const VoiceContext = createContext(null);

export function VoiceProvider({ roomId, playerId, name, children }) {
  const voice = useVoiceChat({ roomId, playerId, name });
  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>;
}

// El hook vive junto a su provider a propósito: separarlo sólo mejoraría el fast
// refresh en desarrollo y obligaría a tocar todos los imports del proyecto.
// eslint-disable-next-line react-refresh/only-export-components
export function useVoice() {
  return useContext(VoiceContext);
}
