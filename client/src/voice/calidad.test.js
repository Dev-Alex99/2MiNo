import { describe, it, expect } from 'vitest';
import {
  clasificarPar, leerInforme, crearSeguidorDePar, ESTADOS_PAR, BYTES_PLANOS_TOPE
} from './calidad';
import { PAR_SIN_RUTA, PAR_CAIDO } from './tiempos';

/**
 * Los ocho estados por participante, con métricas sintéticas.
 *
 * Lo que este archivo protege de verdad es la DEGRADACIÓN: sin `getStats` no se
 * puede subir de `enlazado_justo`. Es la regla que impide heredar un aprobado
 * que nadie ha comprobado, y la que hace que el doble de pruebas —que devuelve
 * un Map vacío mientras no le pidan lo contrario— no pueda dar por buena una
 * llamada muda.
 */

/** Un informe de getStats como el que devuelve el navegador: un Map. */
function informe({ rttMs = 40, recibidos = 100, perdidos = 0, bytes = 8000, jitter = 0.01 } = {}) {
  return new Map([
    ['cp_1', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: rttMs / 1000 }],
    ['in_1', { type: 'inbound-rtp', kind: 'audio', packetsReceived: recibidos, packetsLost: perdidos, bytesReceived: bytes, jitter }]
  ]);
}

const CONECTADO = { connectionState: 'connected', iceConnectionState: 'connected', tieneRemota: true };

describe('calidad · leer el informe de getStats', () => {
  it('saca el RTT del par nominado y los contadores de audio entrante', () => {
    expect(leerInforme(informe({ rttMs: 120, recibidos: 500, perdidos: 5, bytes: 40000 })))
      .toEqual({ rttMs: 120, recibidos: 500, perdidos: 5, jitter: 0.01, bytes: 40000 });
  });

  it('ignora el par de candidatos que NO está nominado', () => {
    const m = new Map([['cp_2', { type: 'candidate-pair', state: 'succeeded', nominated: false, currentRoundTripTime: 9 }]]);
    expect(leerInforme(m)).toBe(null);
  });

  it('acepta también un objeto plano y un array, que es como se escriben los tests', () => {
    const filas = [{ type: 'inbound-rtp', kind: 'audio', packetsReceived: 10, bytesReceived: 99 }];
    expect(leerInforme(filas).bytes).toBe(99);
    expect(leerInforme({ a: filas[0] }).bytes).toBe(99);
  });

  it('un informe vacío es null, no un cero que parezca una medida', () => {
    expect(leerInforme(new Map())).toBe(null);
    expect(leerInforme(null)).toBe(null);
  });
});

describe('calidad · los ocho estados', () => {
  it('sin descripción remota todavía se está negociando', () => {
    expect(clasificarPar({ connectionState: 'new', tieneRemota: false })).toBe('negociando');
  });

  it('con ICE en checking se está probando', () => {
    expect(clasificarPar({ iceConnectionState: 'checking', tieneRemota: true })).toBe('probando');
  });

  it('enlazado_bien exige RTT bajo, poca pérdida Y BYTES CRECIENDO', () => {
    expect(clasificarPar({ ...CONECTADO, muestra: { rttMs: 40, perdida: 0, bytesNuevos: true } }))
      .toBe('enlazado_bien');
    // Mismos números, sin un byte nuevo: no se afirma que se oiga.
    expect(clasificarPar({ ...CONECTADO, muestra: { rttMs: 40, perdida: 0, bytesNuevos: false } }))
      .toBe('enlazado_justo');
  });

  it('enlazado_justo es la franja de en medio, por RTT o por pérdida', () => {
    expect(clasificarPar({ ...CONECTADO, muestra: { rttMs: 200, perdida: 0, bytesNuevos: true } })).toBe('enlazado_justo');
    expect(clasificarPar({ ...CONECTADO, muestra: { rttMs: 40, perdida: 0.05, bytesNuevos: true } })).toBe('enlazado_justo');
  });

  it('inestable por RTT alto, por pérdida alta o por ICE parpadeando', () => {
    expect(clasificarPar({ ...CONECTADO, muestra: { rttMs: 900, perdida: 0, bytesNuevos: true } })).toBe('inestable');
    expect(clasificarPar({ ...CONECTADO, muestra: { rttMs: 40, perdida: 0.2, bytesNuevos: true } })).toBe('inestable');
    expect(clasificarPar({ connectionState: 'disconnected', tieneRemota: true })).toBe('inestable');
  });

  it('sin_ruta por fallo de ICE, que sin TURN es el caso ESPERADO', () => {
    expect(clasificarPar({ connectionState: 'failed', tieneRemota: true })).toBe('sin_ruta');
  });

  it('sin_ruta también por plazo: 15 s sin conectar', () => {
    expect(clasificarPar({ iceConnectionState: 'checking', tieneRemota: true, msDesdeCreacion: PAR_SIN_RUTA - 1 }))
      .toBe('probando');
    expect(clasificarPar({ iceConnectionState: 'checking', tieneRemota: true, msDesdeCreacion: PAR_SIN_RUTA }))
      .toBe('sin_ruta');
  });

  it('ido cuando el fallo se sostiene 20 s', () => {
    expect(clasificarPar({ connectionState: 'failed', msEnFallo: PAR_CAIDO - 1 })).toBe('sin_ruta');
    expect(clasificarPar({ connectionState: 'failed', msEnFallo: PAR_CAIDO })).toBe('ido');
  });

  /**
   * La ausencia la declara el SERVIDOR y gana a cualquier métrica local: los
   * paquetes dejan de llegar porque la otra persona está reconectando, no porque
   * la ruta sea mala. Decir «inestable» ahí sería culpar a la red.
   */
  it('ausente gana a todo lo demás', () => {
    expect(clasificarPar({ ...CONECTADO, ausente: true, muestra: { rttMs: 10, perdida: 0, bytesNuevos: true } }))
      .toBe('ausente');
    expect(clasificarPar({ connectionState: 'failed', ausente: true })).toBe('ausente');
  });

  it('los ocho nombres son exactamente los del contrato', () => {
    expect(ESTADOS_PAR).toEqual([
      'negociando', 'probando', 'enlazado_bien', 'enlazado_justo',
      'inestable', 'sin_ruta', 'ausente', 'ido'
    ]);
  });
});

describe('calidad · la degradación obligatoria', () => {
  it('sin getStats NUNCA se declara más de enlazado_justo', () => {
    expect(clasificarPar({ ...CONECTADO, sinEstadisticas: true })).toBe('enlazado_justo');
    // Ni siquiera pasándole una muestra buena: si no hay estadísticas, no hay
    // muestra que valga.
    expect(clasificarPar({ ...CONECTADO, sinEstadisticas: true, muestra: { rttMs: 5, perdida: 0, bytesNuevos: true } }))
      .toBe('enlazado_justo');
  });

  it('conectado y sin ninguna muestra todavía tampoco pasa de justo', () => {
    expect(clasificarPar({ ...CONECTADO, muestra: null })).toBe('enlazado_justo');
  });
});

describe('calidad · el seguidor, que es quien tiene memoria', () => {
  const lectura = (extra = {}) => ({
    ahora: 0, connectionState: 'connected', iceConnectionState: 'connected', tieneRemota: true, ...extra
  });

  it('la primera muestra no basta: hacen falta dos para restar', () => {
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    expect(s.observar(lectura({ informe: informe({ bytes: 8000 }) }))).toBe('enlazado_justo');
    expect(s.observar(lectura({ informe: informe({ bytes: 16000, recibidos: 200 }) }))).toBe('enlazado_bien');
  });

  it('calcula la pérdida como fracción de la MUESTRA, no del acumulado', () => {
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    s.observar(lectura({ informe: informe({ recibidos: 1000, perdidos: 0, bytes: 8000 }) }));
    // 100 recibidos y 20 perdidos en este ciclo: 16 % — inestable, aunque el
    // acumulado histórico siga siendo excelente.
    const estado = s.observar(lectura({ informe: informe({ recibidos: 1100, perdidos: 20, bytes: 16000 }) }));
    expect(estado).toBe('inestable');
  });

  /**
   * El caso que sólo se ve midiendo: la conexión dice 'connected', el ICE dice
   * 'connected' y NO ENTRA UN BYTE. Es una llamada que parece funcionar.
   */
  it('bytes planos tres muestras seguidas es inestable', () => {
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    s.observar(lectura({ informe: informe({ bytes: 8000, recibidos: 100 }) }));
    for (let i = 1; i <= BYTES_PLANOS_TOPE - 1; i++) {
      expect(s.observar(lectura({ informe: informe({ bytes: 8000, recibidos: 100 + i * 100 }) })))
        .toBe('enlazado_justo');
    }
    expect(s.observar(lectura({ informe: informe({ bytes: 8000, recibidos: 500 }) }))).toBe('inestable');
    // Y en cuanto vuelve a entrar audio, el contador se pone a cero.
    expect(s.observar(lectura({ informe: informe({ bytes: 24000, recibidos: 600 }) }))).toBe('enlazado_bien');
  });

  it('mide desde cuándo está en fallo, para el par ido de los 20 s', () => {
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    expect(s.observar(lectura({ ahora: 1000, connectionState: 'failed', iceConnectionState: 'failed' }))).toBe('sin_ruta');
    expect(s.observar(lectura({ ahora: 1000 + PAR_CAIDO - 1, connectionState: 'failed', iceConnectionState: 'failed' })))
      .toBe('sin_ruta');
    expect(s.observar(lectura({ ahora: 1000 + PAR_CAIDO, connectionState: 'failed', iceConnectionState: 'failed' })))
      .toBe('ido');
  });

  it('un fallo que se cura reinicia el cronómetro del par ido', () => {
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    s.observar(lectura({ ahora: 0, connectionState: 'failed', iceConnectionState: 'failed' }));
    s.observar(lectura({ ahora: 5000 }));
    expect(s.observar(lectura({ ahora: PAR_CAIDO + 5000, connectionState: 'failed', iceConnectionState: 'failed' })))
      .toBe('sin_ruta');
  });

  it('con getStats reventando cae a connectionState y no pasa de justo', () => {
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    expect(s.observar(lectura({ sinEstadisticas: true }))).toBe('enlazado_justo');
    expect(s.observar(lectura({ sinEstadisticas: true }))).toBe('enlazado_justo');
  });
});

/**
 * El mismo camino, pero contra el doble de RTCPeerConnection del banco de
 * pruebas: es la garantía de que lo que mide el módulo puro y lo que produce el
 * arnés hablan el mismo idioma. Si el doble cambia de forma, esto se pone rojo
 * aquí y no dentro de una prueba de integración de tres pantallas.
 */
describe('calidad · contra el doble del banco de pruebas', () => {
  it('una conexión sana con dos muestras llega a enlazado_bien', async () => {
    const pc = new RTCPeerConnection();
    pc.__conectar();
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    pc.__simular({ rtt: 40, perdida: 0 });
    s.observar({ ahora: 0, connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, tieneRemota: true, informe: await pc.getStats() });
    pc.__simular({ rtt: 40, perdida: 0 });
    const estado = s.observar({ ahora: 2000, connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, tieneRemota: true, informe: await pc.getStats() });
    expect(estado).toBe('enlazado_bien');
  });

  it('un getStats() vacío —el estado por defecto del doble— no pasa de justo', async () => {
    const pc = new RTCPeerConnection();
    pc.__conectar();
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    expect(s.observar({ ahora: 0, connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, tieneRemota: true, informe: await pc.getStats() }))
      .toBe('enlazado_justo');
  });

  it('__fallarIce() del doble es exactamente «sin ruta»', () => {
    const pc = new RTCPeerConnection();
    pc.__fallarIce();
    const s = crearSeguidorDePar({ nacidoEn: 0 });
    expect(s.observar({ ahora: 0, connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, tieneRemota: true }))
      .toBe('sin_ruta');
  });
});
