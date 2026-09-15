/**
 * Calidad POR PARTICIPANTE. Módulo puro: entra un informe de `getStats()` (o
 * ninguno) y sale una de las ocho palabras del contrato.
 *
 * Antes de esto no había en todo `client/src` un solo manejador de
 * `onconnectionstatechange` ni una sola llamada a `getStats`: la interfaz decía
 * «Conectado P2P» a partir de un `setState` optimista y nada más.
 *
 * DOS IDEAS QUE GOBIERNAN EL ARCHIVO:
 *
 * 1. El fracaso es POR PAR, nunca un veredicto global. En una malla lo normal es
 *    que unos conecten y otros no; tumbar la llamada porque un tercero está tras
 *    un NAT simétrico castiga a los dos que sí se oían.
 * 2. Nunca se afirma `enlazado_bien` sin BYTES MEDIDOS. Si `getStats` no existe
 *    o revienta, se cae a `connectionState` y el techo es `enlazado_justo`. Un
 *    navegador viejo puede quedarse sin diagnóstico fino; lo que no puede es
 *    heredar un aprobado que nadie ha comprobado.
 */

import { PAR_SIN_RUTA, PAR_CAIDO } from './tiempos';

export const ESTADOS_PAR = [
  'negociando', 'probando', 'enlazado_bien', 'enlazado_justo',
  'inestable', 'sin_ruta', 'ausente', 'ido'
];

/** Los que se le cuentan al otro extremo por `voice_peer_state` (§5.4 del contrato). */
export const ESTADOS_COMPARTIBLES = [
  'negociando', 'probando', 'enlazado_bien', 'enlazado_justo', 'inestable', 'sin_ruta'
];

export const RTT_BIEN_MS = 150;
export const RTT_MALO_MS = 400;
export const PERDIDA_BIEN = 0.02;
export const PERDIDA_MALA = 0.08;
/** Tres muestras seguidas sin un byte nuevo: hay conexión y no hay audio. */
export const BYTES_PLANOS_TOPE = 3;

/**
 * Saca del informe de `getStats()` las dos filas que importan.
 *
 * Acepta un `Map` (lo que devuelve el navegador y el doble de pruebas), un
 * iterable de filas o un objeto plano, porque el informe real es un
 * `RTCStatsReport` y los tests suelen escribir un objeto a mano.
 *
 * Devuelve CONTADORES ACUMULADOS, no incrementos: los deltas los calcula el
 * seguidor, que es quien tiene memoria.
 */
export function leerInforme(informe) {
  if (!informe) return null;
  let filas;
  if (typeof informe.forEach === 'function') { filas = []; informe.forEach(f => filas.push(f)); }
  else if (Array.isArray(informe)) filas = informe;
  else if (typeof informe === 'object') filas = Object.values(informe);
  else return null;

  let rttMs = null, recibidos = null, perdidos = null, jitter = null, bytes = null;
  for (const f of filas) {
    if (!f || typeof f !== 'object') continue;
    if (f.type === 'candidate-pair' && f.state === 'succeeded' && f.nominated) {
      if (typeof f.currentRoundTripTime === 'number') rttMs = f.currentRoundTripTime * 1000;
    } else if (f.type === 'inbound-rtp' && (f.kind === 'audio' || f.mediaType === 'audio')) {
      if (typeof f.packetsReceived === 'number') recibidos = f.packetsReceived;
      if (typeof f.packetsLost === 'number') perdidos = f.packetsLost;
      if (typeof f.jitter === 'number') jitter = f.jitter;
      if (typeof f.bytesReceived === 'number') bytes = f.bytesReceived;
    }
  }
  if (rttMs === null && recibidos === null && bytes === null) return null;
  return { rttMs, recibidos, perdidos, jitter, bytes };
}

const CONECTADO = ['connected', 'completed'];

/**
 * Clasifica UN par. Puro y sin reloj: los plazos llegan ya medidos en ms.
 *
 * @param {object} e
 *   connectionState, iceConnectionState  del RTCPeerConnection
 *   tieneRemota        hay descripción remota (si no: todavía se negocia)
 *   ausente            el SERVIDOR dice que esa persona está reconectando
 *   msDesdeCreacion    desde que se creó el par
 *   msEnFallo          tiempo sostenido en 'failed'/'disconnected' (0 si no)
 *   sinEstadisticas    getStats no existe o rechazó
 *   muestra            { rttMs, perdida, bytesNuevos } de ESTE ciclo, o null
 *   bytesPlanos        ciclos seguidos sin un byte nuevo
 */
export function clasificarPar(e) {
  const {
    connectionState = 'new', iceConnectionState = 'new', tieneRemota = false,
    ausente = false, msDesdeCreacion = 0, msEnFallo = 0,
    sinEstadisticas = false, muestra = null, bytesPlanos = 0
  } = e || {};

  // La ausencia la declara el servidor y gana a cualquier métrica local: los
  // paquetes dejan de llegar porque la otra persona está reconectando, no
  // porque la ruta sea mala. Decir «inestable» ahí sería culpar a la red.
  if (ausente) return 'ausente';

  const enFallo = connectionState === 'failed' || iceConnectionState === 'failed';
  const parpadeando = connectionState === 'disconnected' || iceConnectionState === 'disconnected';

  if ((enFallo || parpadeando) && msEnFallo >= PAR_CAIDO) return 'ido';
  if (enFallo) return 'sin_ruta';

  if (CONECTADO.includes(connectionState) || CONECTADO.includes(iceConnectionState)) {
    // Sin métricas no se puede subir de 'justo'. Es la degradación obligatoria.
    if (sinEstadisticas || !muestra) return 'enlazado_justo';
    if (bytesPlanos >= BYTES_PLANOS_TOPE) return 'inestable';

    const rtt = typeof muestra.rttMs === 'number' ? muestra.rttMs : null;
    const perdida = typeof muestra.perdida === 'number' ? muestra.perdida : 0;

    if ((rtt !== null && rtt > RTT_MALO_MS) || perdida > PERDIDA_MALA) return 'inestable';
    if ((rtt !== null && rtt >= RTT_BIEN_MS) || perdida >= PERDIDA_BIEN) return 'enlazado_justo';
    // Y aquí es donde se exige lo que la interfaz vieja daba por hecho: bytes.
    if (!muestra.bytesNuevos) return 'enlazado_justo';
    if (rtt === null) return 'enlazado_justo';
    return 'enlazado_bien';
  }

  if (parpadeando) return 'inestable';

  // Todavía intentándolo. A los 15 s se declara sin ruta, pero el par NO se
  // cierra: sigue probando en segundo plano y si conecta tarde vuelve solo.
  if (msDesdeCreacion >= PAR_SIN_RUTA) return 'sin_ruta';
  if (!tieneRemota) return 'negociando';
  if (iceConnectionState === 'checking') return 'probando';
  return 'probando';
}

/**
 * Seguidor con memoria de UN par: guarda los contadores anteriores para poder
 * restar, cuenta los ciclos con los bytes planos y recuerda desde cuándo está en
 * fallo. Sigue sin tocar el navegador: se le pasa todo.
 */
export function crearSeguidorDePar({ nacidoEn = 0 } = {}) {
  let previa = null;
  let bytesPlanos = 0;
  let falloDesde = null;
  let ultimo = 'negociando';

  return {
    get estado() { return ultimo; },
    get bytesPlanos() { return bytesPlanos; },

    /**
     * @param {object} lectura
     *   ahora, connectionState, iceConnectionState, tieneRemota, ausente
     *   informe          lo que devolvió getStats (o null)
     *   sinEstadisticas  getStats no existe o rechazó
     */
    observar(lectura) {
      const { ahora = 0, connectionState, iceConnectionState, tieneRemota, ausente, informe, sinEstadisticas } = lectura;

      const enFallo = connectionState === 'failed' || iceConnectionState === 'failed' ||
                      connectionState === 'disconnected' || iceConnectionState === 'disconnected';
      if (enFallo) { if (falloDesde === null) falloDesde = ahora; }
      else falloDesde = null;

      const bruto = sinEstadisticas ? null : leerInforme(informe);
      let muestra = null;
      if (bruto) {
        if (previa) {
          const dRecibidos = (bruto.recibidos ?? 0) - (previa.recibidos ?? 0);
          const dPerdidos = (bruto.perdidos ?? 0) - (previa.perdidos ?? 0);
          const dBytes = (bruto.bytes ?? 0) - (previa.bytes ?? 0);
          const total = dRecibidos + dPerdidos;
          muestra = {
            rttMs: bruto.rttMs,
            perdida: total > 0 ? dPerdidos / total : 0,
            jitter: bruto.jitter,
            bytesNuevos: dBytes > 0
          };
          if (dBytes > 0) bytesPlanos = 0; else bytesPlanos += 1;
        }
        previa = bruto;
      }

      ultimo = clasificarPar({
        connectionState, iceConnectionState, tieneRemota, ausente,
        msDesdeCreacion: ahora - nacidoEn,
        msEnFallo: falloDesde === null ? 0 : ahora - falloDesde,
        sinEstadisticas: !!sinEstadisticas,
        muestra,
        bytesPlanos
      });
      return ultimo;
    }
  };
}
