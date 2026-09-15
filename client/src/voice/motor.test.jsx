import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import useGameSocket from '../hooks/useGameSocket';
import { VoiceProvider } from './VoiceContext';
import { render, resetStores, setGameStore } from '../test/utils';
import { useLineaStore, acciones } from './useLineaStore';
import { PAR_SIN_RUTA, MUESTREO_CALIDAD } from './tiempos';

const socket = globalThis.__socket;

/**
 * El motor de la voz, cableado de verdad: contra el doble de socket, el de
 * RTCPeerConnection y el de getUserMedia.
 *
 * Los tres caminos que este archivo cubre y que hasta ahora no cubría NADA (ni
 * una aserción sobre las 707 líneas del hook, verificado):
 *
 *  1. La URL del ICE. `fetch('/api/turn-credentials')` es una ruta que no
 *     existe; en desarrollo la servía Vite, que devuelve el index.html con 200
 *     OK, así que `res.json()` reventaba con '<' y lo tragaba el catch: la voz
 *     corría SIEMPRE con un único STUN y nadie se enteraba.
 *  2. El reenganche. Al reconectar, el socket cambia de id, los pares quedaban
 *     huérfanos y el widget seguía diciendo «Conectado P2P» para siempre.
 *  3. El desmontaje. No existía ninguno: los `<audio>` inyectados en el body y
 *     los RTCPeerConnection sobrevivían al proveedor.
 *
 * NOTA SOBRE EL FICHERO: la verificación del paquete pide «un test de
 * integración con el doble de socket» y no nombra archivo. Va aquí y no dentro
 * de maquina.test.js / calidad.test.js porque esos dos prueban módulos PUROS y
 * mezclarlos con un árbol de React haría que un fallo de render se leyera como
 * un fallo de la máquina de estados.
 */

const linea = () => useLineaStore.getState();

/**
 * El arnés mínimo: la capa de red REAL (`useGameSocket`, que es quien emite
 * `hello` + `voice_hello` en cada `connect`) y el proveedor de voz, sin una
 * línea de interfaz.
 *
 * Se monta esto y no `<App/>` a propósito: lo que hay que probar aquí es el
 * motor, y montar la aplicación entera ataría estas pruebas al hub, a los
 * modales y al lobby —tres superficies que están reescribiendo otros paquetes en
 * paralelo—, de modo que un fallo ajeno se leería como un fallo de la voz.
 */
function Arnes() {
  const invitedCodeRef = React.useRef('');
  useGameSocket({ invitedCodeRef });
  return <VoiceProvider><div data-testid="arnes" /></VoiceProvider>;
}

/** Reinicia también las dos banderas que ESTADO_LIMPIO todavía no declara. */
function reiniciar() {
  resetStores();
  setGameStore({ salaFantasma: '', sesionNoVerificada: false });
}

/** Un pool de dos: yo (por mi id de CUENTA) y otra persona. */
const DOS = [
  { playerId: 'p_cuenta', name: 'Yo', estado: 'presente' },
  { playerId: 'p_amiga', name: 'Marta', estado: 'presente' }
];

async function conLlamadaEnMarcha() {
  globalThis.__mediaDevices.darStream();
  render(<Arnes />);
  await act(async () => {
    socket.recibir('voice_pool_updated', {
      poolId: 'pool1', contexto: { tipo: 'privado', roomId: null }, miembros: DOS
    });
  });
  await waitFor(() => expect(RTCPeerConnection.__todas().length).toBe(1));
  return RTCPeerConnection.__ultima();
}

describe('motor · la configuración de ICE', () => {
  beforeEach(reiniciar);

  it('se pide a `${serverUrl}/ice-config`, no a la ruta que no existe', async () => {
    await conLlamadaEnMarcha();
    const urls = globalThis.__fetch.llamadas().map(l => l.url);
    expect(urls).toContain('http://test.local/ice-config');
    expect(urls.some(u => u.includes('/api/turn-credentials'))).toBe(false);
  });

  it('el modo de retransmisión llega del servidor, no se adivina', async () => {
    globalThis.__fetch.iceConfig({ turnMode: 'cloudflare', turnConfigured: true });
    await conLlamadaEnMarcha();
    // Ramifica por la CADENA. `turnConfigured` sigue siendo false en el modo por
    // defecto del servidor aunque haya tres URLs de openrelay reales, así que
    // escribir el copy a partir del booleano mentiría en la otra dirección.
    await waitFor(() => expect(linea().relevo).toBe('cloudflare'));
  });
});

describe('motor · la identidad y la malla', () => {
  beforeEach(reiniciar);

  it('no se abre un par contra uno mismo', async () => {
    await conLlamadaEnMarcha();
    expect(RTCPeerConnection.__todas()).toHaveLength(1);
    expect(Object.keys(linea().pares)).toEqual(['p_amiga']);
  });

  it('la señalización sale SIN poolId y dirigida a la otra persona', async () => {
    const pc = await conLlamadaEnMarcha();
    await act(async () => { pc.__candidato(); });
    const senal = socket.ultimoEmitido('voice_pool_signal');
    expect(senal.toPlayerId).toBe('p_amiga');
    expect(senal).not.toHaveProperty('poolId');
  });

  /**
   * Dos personas que entran casi a la vez. Los dos `voice_pool_updated` llegan
   * antes de que el primero haya terminado de abrir su par, así que los dos
   * recorridos de la malla se solapan — y el barrido final del PRIMERO («destruye
   * a quien ya no está en la lista») puede llevarse por delante el par que
   * acababa de crear el SEGUNDO. Resultado: un participante mudo para siempre,
   * sin error y sin nada que lo delate hasta que alguien pregunte «¿me oís?».
   */
  it('dos actualizaciones seguidas del pool no se pisan la malla', async () => {
    globalThis.__mediaDevices.darStream();
    render(<Arnes />);
    await act(async () => {
      socket.recibir('voice_pool_updated', {
        poolId: 'pool1', contexto: { tipo: 'privado', roomId: null }, miembros: DOS
      });
      socket.recibir('voice_pool_updated', {
        poolId: 'pool1', contexto: { tipo: 'privado', roomId: null },
        miembros: [...DOS, { playerId: 'p_luis', name: 'Luis', estado: 'presente' }]
      });
    });
    await waitFor(() => expect(Object.keys(linea().pares).sort()).toEqual(['p_amiga', 'p_luis']));
    expect(RTCPeerConnection.__abiertas()).toHaveLength(2);
  });

  /**
   * Colgar mientras el navegador todavía enseña el diálogo del micrófono. El
   * recorrido de la malla estaba parado en ese `await`; al reanudar, abriría una
   * RTCPeerConnection para una llamada que ya no existe —conexión nacida muerta y
   * micro encendido para nadie—, y nada volvería a cerrarla.
   */
  it('colgar mientras se espera al micro no deja abrirse un par tardío', async () => {
    let entregar;
    globalThis.__mediaDevices.responder(() => new Promise(res => { entregar = res; }));
    render(<Arnes />);

    await act(async () => {
      socket.recibir('voice_pool_updated', {
        poolId: 'pool1', contexto: { tipo: 'privado', roomId: null }, miembros: DOS
      });
    });
    expect(RTCPeerConnection.__todas()).toHaveLength(0);   // sigue esperando al micro

    await act(async () => { acciones.colgar(); });
    expect(linea()).toMatchObject({ estado: 'cerrada', motivo: 'colgado_por_mi' });

    await act(async () => {
      entregar(globalThis.__mediaDevices.crearStream({ audio: 1 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(RTCPeerConnection.__abiertas()).toHaveLength(0);
    expect(linea().pares).toEqual({});
  });

  it('quien sale del pool pierde su par y su fila', async () => {
    await conLlamadaEnMarcha();
    const pc = RTCPeerConnection.__ultima();
    await act(async () => {
      socket.recibir('voice_pool_updated', {
        poolId: 'pool1', contexto: { tipo: 'privado', roomId: null },
        miembros: [{ playerId: 'p_cuenta', name: 'Yo', estado: 'presente' }]
      });
    });
    expect(pc.__cerrado).toBe(true);
    expect(linea()).toMatchObject({ estado: 'cerrada', motivo: 'colgado_por_el_otro' });
  });
});

describe('motor · el reenganche tras perder el socket', () => {
  beforeEach(reiniciar);

  /**
   * El fallo que hace la voz inservible en móvil. `socket.js` configura
   * `reconnectionAttempts: Infinity` porque en móvil se reconecta constantemente
   * (wifi→4G, ascensores, túneles); al reconectar, el pool del servidor cacheaba
   * el socketId viejo y NINGÚN camino volvía a montar la llamada.
   */
  it('la caída lleva a recuperando y NO cierra ni un par', async () => {
    await conLlamadaEnMarcha();
    const abiertasAntes = RTCPeerConnection.__abiertas().length;
    expect(abiertasAntes).toBe(1);

    act(() => { socket.recibir('connect'); });   // el estado honesto: conectados
    act(() => { socket.simularDesconexion(); });

    expect(linea().estado).toBe('recuperando');
    // Una `pc` no muere porque muera el socket de señalización. Si el reenganche
    // llega a tiempo, el audio no se cortó ni un instante.
    expect(RTCPeerConnection.__abiertas()).toHaveLength(abiertasAntes);
  });

  it('al volver la conexión sale UN voice_hello, y el voice_state devuelve la línea', async () => {
    await conLlamadaEnMarcha();
    act(() => { socket.recibir('connect'); });
    act(() => { socket.simularDesconexion(); });
    socket.limpiarEmitidos();

    const idNuevo = act(() => socket.simularConexion());
    expect(idNuevo).toBeDefined();

    // El saludo lo manda `useGameSocket` justo detrás del `hello`. El motor NO
    // lo duplica: si lo emitiera también, cada reconexión mandaría dos.
    expect(socket.emitidos('voice_hello')).toHaveLength(1);
    const orden = socket.emitidos().map(e => e.evento);
    expect(orden.indexOf('voice_hello')).toBe(orden.indexOf('hello') + 1);

    await act(async () => {
      socket.recibir('voice_state', {
        pool: { poolId: 'pool1', contexto: { tipo: 'privado', roomId: null }, miembros: DOS },
        enOtraPestana: false,
        timbrando: []
      });
    });
    expect(linea().estado).toBe('enlazando');
    expect(RTCPeerConnection.__abiertas()).toHaveLength(1);
  });

  /**
   * El ciclo completo con el ayudante del banco, que es como lo escribe la
   * verificación del paquete. El id del socket CAMBIA, que es exactamente lo que
   * dejaba huérfanos los pares del servidor: el pool cacheaba el socketId viejo.
   */
  it('simularReconexion() renueva el id y vuelve a saludar a la voz', async () => {
    await conLlamadaEnMarcha();
    act(() => { socket.recibir('connect'); });
    const idViejo = socket.id;
    socket.limpiarEmitidos();

    let idNuevo;
    act(() => { idNuevo = socket.simularReconexion(); });

    expect(idNuevo).not.toBe(idViejo);
    expect(socket.emitidos('voice_hello')).toHaveLength(1);
    // Y los pares siguieron abiertos durante todo el hueco.
    expect(RTCPeerConnection.__abiertas()).toHaveLength(1);
  });

  it('si el servidor ya no conoce la sesión, se dice: sesion_perdida', async () => {
    await conLlamadaEnMarcha();
    act(() => { socket.recibir('connect'); });
    act(() => { socket.simularDesconexion(); });
    await act(async () => {
      socket.recibir('voice_state', { pool: null, enOtraPestana: false, timbrando: [] });
    });
    expect(linea()).toMatchObject({ estado: 'cerrada', motivo: 'sesion_perdida' });
    expect(RTCPeerConnection.__abiertas()).toHaveLength(0);
  });
});

describe('motor · el micrófono aborta la llamada, no la deja muda', () => {
  beforeEach(reiniciar);

  it('con el micro denegado no se emite call_friend a nadie', async () => {
    globalThis.__mediaDevices.fallarCon('NotAllowedError');
    render(<Arnes />);
    await act(async () => { acciones.llamar('p_amiga', 'Marta'); });

    await waitFor(() => expect(linea().estado).toBe('cerrada'));
    expect(linea().motivo).toBe('micro_bloqueado');
    // Nadie recibe el timbre de alguien que va a salir mudo.
    expect(socket.emitidos('call_friend')).toHaveLength(0);
    // Y el error tiene su clave, que YA existía traducida y no la usaba nadie.
    expect(linea().micError).toEqual({ motivo: 'micro_bloqueado', clave: 'voice.errMic' });
  });

  it('«entrar solo a escuchar» monta la malla SIN pista propia', async () => {
    globalThis.__mediaDevices.fallarCon('NotFoundError');
    render(<Arnes />);
    await act(async () => { acciones.llamar('p_amiga', 'Marta'); });
    await waitFor(() => expect(linea().motivo).toBe('micro_ausente'));

    await act(async () => { acciones.soloEscuchar(); });
    expect(socket.emitidos('call_friend')).toHaveLength(1);

    await act(async () => {
      socket.recibir('voice_pool_updated', {
        poolId: 'pool1', contexto: { tipo: 'privado', roomId: null }, miembros: DOS
      });
    });
    await waitFor(() => expect(RTCPeerConnection.__todas().length).toBe(1));
    // La conexión existe y no lleva ni una pista de salida: se oye, no se habla.
    expect(RTCPeerConnection.__ultima().getSenders()).toHaveLength(0);
  });

  it('un micrófono ocupado tiene su propio motivo y su propia clave', async () => {
    globalThis.__mediaDevices.fallarCon('NotReadableError');
    render(<Arnes />);
    await act(async () => { acciones.llamar('p_amiga'); });
    await waitFor(() => expect(linea().micError).toEqual({ motivo: 'micro_ocupado', clave: 'voice.errBusyMic' }));
  });
});

describe('motor · los tres oyentes que faltaban', () => {
  beforeEach(reiniciar);

  /**
   * «Llamando…» eterno: el servidor devuelve `call_error` y RETORNA antes de
   * crear la llamada, así que tampoco arma su temporizador de 30 s. El cliente
   * no escuchaba `call_error` en ningún sitio, y sólo se salía pulsando colgar.
   */
  it('call_error termina la llamada saliente con su motivo', async () => {
    globalThis.__mediaDevices.darStream();
    render(<Arnes />);
    await act(async () => { acciones.llamar('p_amiga', 'Marta'); });
    await waitFor(() => expect(linea().estado).toBe('saliente'));

    await act(async () => { socket.recibir('call_error', { callId: null, code: 'desconectado' }); });
    expect(linea()).toMatchObject({ estado: 'cerrada', motivo: 'amigo_desconectado' });
  });

  it('call_cancelled apaga el timbre entrante en vez de dejarlo puesto', async () => {
    render(<Arnes />);
    await act(async () => {
      socket.recibir('incoming_call', {
        callId: 'c1', fromPlayerId: 'p_amiga', fromName: 'Marta', tipo: 'directa', expiraEn: Date.now() + 30000
      });
    });
    expect(linea().estado).toBe('entrante');
    act(() => socket.simularTimbreAtendidoEnOtraPestana('c1'));
    expect(linea().estado).toBe('inactiva');
  });

  it('voice_pool_left cierra la línea con el motivo que manda el servidor', async () => {
    await conLlamadaEnMarcha();
    await act(async () => { socket.recibir('voice_pool_left', { poolId: 'pool1', motivo: 'linea_vacia' }); });
    expect(linea()).toMatchObject({ estado: 'cerrada', motivo: 'colgado_por_el_otro' });
  });

  it('el relevo de otra pestaña desmonta esta, que es la regla de UNA sesión por cuenta', async () => {
    await conLlamadaEnMarcha();
    act(() => socket.simularRelevoDeOtraPestana('c1'));
    expect(linea()).toMatchObject({ estado: 'cerrada', motivo: 'atendida_en_otra_pestana' });
    expect(RTCPeerConnection.__abiertas()).toHaveLength(0);
  });
});

describe('motor · los dos diccionarios de quién habla', () => {
  beforeEach(reiniciar);

  it('voice_pool_speaking indexa por CUENTA y table_speaking por ALIAS', async () => {
    await conLlamadaEnMarcha();
    await act(async () => {
      socket.recibir('voice_pool_speaking', { playerId: 'p_amiga', speaking: true });
      // `alias` viaja como ARRAY: todo lo que va a una sala pasa por
      // `emitirAMesa()`, que produce un array (lo reportó P4-SRV).
      socket.recibir('table_speaking', { roomId: 'ABCD', alias: ['s_abc'], speaking: true });
    });
    expect(linea().hablandoEnLinea).toEqual({ p_amiga: true });
    expect(linea().hablandoEnMesa).toEqual({ s_abc: true });
  });

  it('table_voice cuenta a TODA la línea y sólo aliasa a los sentados', async () => {
    render(<Arnes />);
    await act(async () => { socket.recibir('table_voice', { roomId: 'ABCD', alias: ['s_abc'], n: 3 }); });
    expect(linea().vozDeMesa).toEqual({ roomId: 'ABCD', alias: ['s_abc'], n: 3 });
  });

  /**
   * Los alias los acuña `seatAliases` POR SALA, así que dos mesas distintas
   * pueden repartir el mismo 's_abc'. Arrastrar el diccionario de una mesa a la
   * siguiente encendería el anillo de «está hablando» sobre el asiento
   * equivocado — sin error, sin síntoma y sin forma de apagarlo.
   */
  it('cambiar de mesa tira el diccionario de alias anterior', async () => {
    render(<Arnes />);
    await act(async () => {
      socket.recibir('table_voice', { roomId: 'ABCD', alias: ['s_abc'], n: 1 });
      socket.recibir('table_speaking', { roomId: 'ABCD', alias: ['s_abc'], speaking: true });
    });
    expect(linea().hablandoEnMesa).toEqual({ s_abc: true });

    await act(async () => { socket.recibir('table_voice', { roomId: 'EFGH', alias: [], n: 0 }); });
    expect(linea().hablandoEnMesa).toEqual({});
    expect(linea().vozDeMesa.roomId).toBe('EFGH');
  });

  it('un table_speaking de otra mesa no toca el diccionario de ésta', async () => {
    render(<Arnes />);
    await act(async () => {
      socket.recibir('table_voice', { roomId: 'ABCD', alias: ['s_abc'], n: 1 });
      socket.recibir('table_speaking', { roomId: 'ZZZZ', alias: ['s_abc'], speaking: true });
    });
    expect(linea().hablandoEnMesa).toEqual({});
  });
});

describe('motor · sin ruta, que sin TURN es el caso esperado', () => {
  beforeEach(reiniciar);

  it('un par que fracasa lleva la línea a sinRuta, y [Reintentar] reinicia el ICE', async () => {
    vi.useFakeTimers();
    try {
      globalThis.__mediaDevices.darStream();
      render(<Arnes />);
      await act(async () => {
        socket.recibir('voice_pool_updated', {
          poolId: 'pool1', contexto: { tipo: 'privado', roomId: null }, miembros: DOS
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      const pc = RTCPeerConnection.__ultima();
      expect(pc).toBeDefined();

      await act(async () => { pc.__fallarIce(); });
      // El fracaso NO cierra el `pc`: sigue intentándolo en segundo plano, y si
      // conecta tarde la fila vuelve a verde sola.
      expect(pc.__cerrado).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(MUESTREO_CALIDAD + 10);
        await Promise.resolve();
      });
      await act(async () => { await Promise.resolve(); });

      expect(linea().pares.p_amiga).toBe('sin_ruta');
      expect(linea().estado).toBe('sinRuta');

      const reiniciosAntes = pc.__reiniciosIce;
        await act(async () => { acciones.reintentar(); });
      expect(pc.__reiniciosIce).toBeGreaterThan(reiniciosAntes);
      expect(linea().estado).toBe('enlazando');
    } finally {
      vi.useRealTimers();
    }
  });

  it('el plazo de sin ruta es el del contrato, no un número suelto', () => {
    expect(PAR_SIN_RUTA).toBe(15000);
  });
});

describe('motor · el desmontaje, que antes no existía', () => {
  beforeEach(reiniciar);

  it('al desmontar no queda un par abierto, ni un <audio> en el body, ni un listener', async () => {
    const pc = await conLlamadaEnMarcha();
    await act(async () => { pc.__pistaEntrante({ kind: 'audio' }); });
    expect(document.body.querySelectorAll('audio').length).toBeGreaterThanOrEqual(1);

    // El árbol se desmonta a mano para poder afirmar sobre lo que queda.
    const { cleanup } = await import('@testing-library/react');
    cleanup();

    expect(RTCPeerConnection.__abiertas()).toHaveLength(0);
    expect(document.body.querySelectorAll('audio')).toHaveLength(0);
    expect(socket.eventosEscuchados()).toEqual([]);
    expect(useLineaStore.getState().estado).toBe('inactiva');
  });
});
