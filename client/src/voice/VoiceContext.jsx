import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { socket } from '../socket';
import { useGameStore } from '../store/useGameStore';
import { useLineaStore, iniciar, detener, despachar, acciones } from './useLineaStore';

/**
 * El estado de la voz vive aquí arriba, por encima de la sala de espera y del
 * tablero. Si el panel montara el motor en cada pantalla, pasar de "esperando" a
 * "jugando" lo desmontaría y cortaría la llamada justo al empezar la partida.
 *
 * Lo que cambia respecto a la versión anterior: el proveedor YA NO RECIBE la
 * identidad por props. La lee del store, y lee `cuentaId` —la PERSONA— y no
 * `playerId` —el asiento, que dentro de una sala es un alias `s_xxxx` y fuera es
 * cadena vacía—. Con el alias, el filtro «este miembro del pool no soy yo» daba
 * cierto también para uno mismo y se abría una RTCPeerConnection contra sí
 * mismo; y `polite = yo < tú` comparaba alias contra cuenta, así que los dos
 * extremos podían calcular el MISMO rol y la negociación perfecta dejaba de
 * poder resolver una colisión de ofertas.
 *
 * Las props que todavía le llegan (`playerId`, `name`, `roomId`) se IGNORAN a
 * propósito, y no se retiran de la firma: App.jsx sigue pasándolas y no es
 * nuestro. Ignorarlas es lo que permite que este paquete y el marco se muevan
 * por separado. Cuando P3 quiera limpiar la llamada, no hay nada que hacer aquí.
 */
const VoiceContext = createContext(null);

/**
 * Lo que el contexto publica. El medidor de entrada (`nivel`, `nivelPalabra`) se
 * queda FUERA a propósito: cambia hasta diez veces por segundo y el proveedor
 * envuelve la aplicación entera. Quien lo pinte lo lee del store directamente,
 * `useLineaStore(s => s.nivel)`, y sólo se repinta él.
 */
function seleccion(s) {
  return {
    estado: s.estado,
    motivo: s.motivo,
    entrante: s.entrante,
    saliente: s.saliente,
    poolId: s.poolId,
    contexto: s.contexto,
    miembros: s.miembros,
    enOtraPestana: s.enOtraPestana,
    timbrando: s.timbrando,
    desde: s.desde,

    pares: s.pares,
    paresRemotos: s.paresRemotos,
    hablandoEnLinea: s.hablandoEnLinea,
    hablandoEnMesa: s.hablandoEnMesa,
    vozDeMesa: s.vozDeMesa,

    muted: s.muted,
    isDeafened: s.isDeafened,
    camOn: s.camOn,
    camBusy: s.camBusy,
    localVideo: s.localVideo,
    remoteVideos: s.remoteVideos,

    dispositivos: s.dispositivos,
    seleccionados: s.seleccionados,
    cambiando: s.cambiando,
    micError: s.micError,
    relevo: s.relevo,
    avisos: s.avisos
  };
}

/** El estado viejo de cuatro valores, derivado del nuevo de diez. */
function callStateDe(estado) {
  switch (estado) {
    case 'entrante': return 'incoming';
    case 'pidiendoMicro':
    case 'saliente': return 'outgoing';
    case 'enlazando':
    case 'abierta':
    case 'fragil':
    case 'sinRuta':
    case 'recuperando': return 'connected';
    default: return 'idle';
  }
}

export function VoiceProvider({ children }) {
  const cuentaId = useGameStore(s => s.cuentaId);
  const isConnected = useGameStore(s => s.isConnected);
  const linea = useLineaStore(useShallow(seleccion));

  // El motor se arranca DENTRO de un efecto, nunca al importar el módulo: sus
  // `socket.on()` tienen que poder volver a registrarse (el banco de pruebas
  // vacía el mapa de handlers en cada afterEach) y tienen que irse al desmontar.
  useEffect(() => {
    if (!cuentaId) return undefined;
    iniciar({ socket, cuentaId });
    return () => detener();
  }, [cuentaId]);

  /**
   * La caída del socket se lee del store, NO con un `socket.on('disconnect')`
   * propio. Hay un dueño del ciclo de vida de la conexión —`useGameSocket`— y
   * duplicar el listener es lo que su propio test prohíbe («cada evento tiene UN
   * solo listener»). Se dispara sólo en la TRANSICIÓN de conectado a caído: si
   * la conexión vuelve en el mismo tick no hay nada que recuperar, y entrar en
   * «recuperando» para salir acto seguido sería un parpadeo gratuito.
   */
  const estabaConectado = useRef(isConnected);
  useEffect(() => {
    if (estabaConectado.current && !isConnected) despachar({ tipo: 'desconectado' });
    estabaConectado.current = isConnected;
  }, [isConnected]);

  const valor = useMemo(() => ({
    ...linea,
    ...acciones,

    /* ─── Superficie LEGADA de `useVoice()`.
       La conservan cuatro consumidores que no son de este paquete: VideoGrid y
       CintaTurno leen `speaking`, EpicMoment y VideoGrid leen `localVideo` y
       `remoteVideos`, y UnifiedVoiceWidget lee el resto hasta que P6-LINEA lo
       borre. Es un puente, no una API: cuando la superficie nueva esté puesta,
       todo lo de aquí abajo se va de golpe. ─── */

    // `speaking` apunta a hablandoEnMesa, que es lo que indexan VideoGrid
    // (por `p.id`) y CintaTurno (por el alias del jugador).
    speaking: linea.hablandoEnMesa,
    isMuted: linea.muted,
    devices: linea.dispositivos,
    selected: linea.seleccionados,
    switching: linea.cambiando,
    callState: callStateDe(linea.estado),
    incomingCall: linea.entrante
      ? { ...linea.entrante, isGroupInvite: linea.entrante.clase === 'grupo' }
      : null,
    voicePool: { poolId: linea.poolId, members: linea.miembros },

    toggleMute: acciones.alternarSilencio,
    toggleDeafen: acciones.alternarEnsordecido,
    toggleCam: acciones.alternarCamara,
    selectMic: acciones.elegirMicro,
    selectCam: acciones.elegirCamara,
    selectSpeaker: acciones.elegirAltavoz,
    callFriend: (a, nombre) => acciones.llamar(a, nombre),
    inviteFriendToPool: (a) => acciones.invitar(a),
    acceptCall: acciones.aceptar,
    declineCall: acciones.rechazar,
    endCall: acciones.colgar,

    // Los «filtros de voz FX» se han retirado del motor: se declaraban, viajaban
    // por props y no tocaban un solo nodo de Web Audio. Estos dos SOBREVIVEN
    // como tocón hasta que P6-LINEA borre DeviceSelector, y no por nostalgia:
    // sus seis botones llaman a `onVoiceFilter(...)`, así que quitarlos de golpe
    // cambiaría «un botón que no hace nada» —que es lo que siempre fueron— por
    // un TypeError en producción. Mueren con la rejilla que los pinta.
    voiceFilter: 'normal',
    setVoiceFilter: () => {}
  }), [linea]);

  return <VoiceContext.Provider value={valor}>{children}</VoiceContext.Provider>;
}

// El hook vive junto a su provider a propósito: separarlo sólo mejoraría el fast
// refresh en desarrollo y obligaría a tocar todos los imports del proyecto.
//
// SIGUE PUDIENDO DEVOLVER null, y hay que contar con ello: `CintaTurno.test.jsx`
// y los tests de los tableros renderizan SIN proveedor, y el widget se monta en
// cuatro sitios distintos. La guarda `voz ? … : …` de los cuatro consumidores
// sigue siendo válida.
// eslint-disable-next-line react-refresh/only-export-components
export function useVoice() {
  return useContext(VoiceContext);
}
