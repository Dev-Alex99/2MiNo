import { describe, it, expect, vi } from 'vitest';
import { createFakeSocket } from './fakeSocket';

/**
 * El banco de pruebas probándose a sí mismo.
 *
 * No cubre ningún comportamiento del producto: cubre las herramientas con las
 * que se van a escribir las pruebas de voz. Existe porque el arnés anterior
 * tenía dos trampas que dejaban tests en verde sin comprobar nada —un doble de
 * `RTCPeerConnection` sin estados ni estadísticas, y un doble de `fetch` que
 * nunca llegaba a instalarse— y porque el reenganche tras reconexión no se podía
 * ni montar. Si algo de esto se rompe, se rompe en silencio en todas partes.
 *
 * Vive en su propio fichero y no dentro de `utils.jsx` porque el `include` de
 * vitest es `src/**\/*.test.{js,jsx}`: un caso escrito en un módulo que no
 * termina en `.test` no se ejecutaría jamás.
 */

const socket = globalThis.__socket;

describe('banco · doble de socket', () => {
  it('simularReconexion cambia el id, avisa de la caída y vuelve a disparar connect', () => {
    const visto = [];
    socket.on('connect', () => visto.push(`connect:${socket.id}`));
    socket.on('disconnect', (motivo) => visto.push(`disconnect:${motivo}`));

    const idPrevio = socket.id;
    const idNuevo = socket.simularReconexion();

    expect(idNuevo).not.toBe(idPrevio);
    expect(socket.id).toBe(idNuevo);
    expect(socket.connected).toBe(true);
    expect(socket.reconexiones).toBe(1);
    expect(visto).toEqual([`disconnect:transport close`, `connect:${idNuevo}`]);
  });

  it('entre la caída y la vuelta el socket queda desconectado, que es el hueco a probar', () => {
    let conectadoAlCaer = null;
    socket.on('disconnect', () => { conectadoAlCaer = socket.connected; });

    socket.simularDesconexion();
    expect(conectadoAlCaer).toBe(false);
    expect(socket.connected).toBe(false);

    socket.simularConexion();
    expect(socket.connected).toBe(true);
  });

  it('reset({conservarHandlers:true}) preserva los listeners; reset() a secas los borra', () => {
    socket.on('voice_state', () => {});
    socket.on('incoming_call', () => {});
    expect(socket.eventosEscuchados()).toEqual(['incoming_call', 'voice_state']);

    socket.emit('voice_hello', {});
    socket.reset({ conservarHandlers: true });

    expect(socket.eventosEscuchados()).toEqual(['incoming_call', 'voice_state']);
    // El registro de emitidos sí se vacía: conservar handlers es para no volver
    // a montar el árbol, no para acumular tráfico de un caso en el siguiente.
    expect(socket.emitidos()).toEqual([]);

    socket.reset();
    expect(socket.eventosEscuchados()).toEqual([]);
  });

  it('el relevo de otra pestaña llega como los dos eventos distintos que son', () => {
    const recibido = [];
    socket.on('call_cancelled', (p) => recibido.push(['call_cancelled', p]));
    socket.on('voice_taken', (p) => recibido.push(['voice_taken', p]));

    socket.simularTimbreAtendidoEnOtraPestana('c1');
    socket.simularRelevoDeOtraPestana('c1');

    expect(recibido).toEqual([
      ['call_cancelled', { callId: 'c1', motivo: 'atendida_en_otra_pestana' }],
      ['voice_taken', { callId: 'c1' }]
    ]);
  });

  it('una segunda instancia sirve de pestaña hermana, con ids que no se confunden', () => {
    const otra = createFakeSocket({ prefijo: 'sk_b' });
    expect(otra.id).toBe('sk_b_1');
    expect(otra.id).not.toBe(socket.id);
    otra.emit('accept_call', { callId: 'c1' });
    // Los dos dobles son independientes: lo que emite la hermana no aparece aquí.
    expect(socket.emitidos('accept_call')).toEqual([]);
    expect(otra.ultimoEmitido('accept_call')).toEqual({ callId: 'c1' });
  });
});

describe('banco · doble de RTCPeerConnection', () => {
  it('los estados son asignables y disparan su manejador', () => {
    const pc = new RTCPeerConnection();
    const visto = [];
    pc.onconnectionstatechange = () => visto.push(`c:${pc.connectionState}`);
    pc.oniceconnectionstatechange = () => visto.push(`i:${pc.iceConnectionState}`);

    pc.__fallarIce();

    expect(visto).toEqual(['i:failed', 'c:failed']);
    expect(pc.connectionState).toBe('failed');
  });

  it('restartIce se cuenta y close no despierta ningún manejador', () => {
    const pc = new RTCPeerConnection();
    let despertares = 0;
    pc.onconnectionstatechange = () => { despertares += 1; };

    pc.restartIce();
    pc.restartIce();
    expect(pc.__reiniciosIce).toBe(2);

    pc.close();
    expect(pc.__cerrado).toBe(true);
    expect(pc.connectionState).toBe('closed');
    expect(despertares).toBe(0);
  });

  it('getStats devuelve un Map vacío hasta que se simula una muestra', async () => {
    const pc = new RTCPeerConnection();
    expect([...(await pc.getStats())]).toEqual([]);

    pc.__simular({ rtt: 120, perdida: 0.01, bytes: 8000 });
    const informe = await pc.getStats();
    const par = [...informe.values()].find(e => e.type === 'candidate-pair');
    const entrante = [...informe.values()].find(e => e.type === 'inbound-rtp');

    // El ayudante habla en milisegundos; getStats, en segundos.
    expect(par.currentRoundTripTime).toBeCloseTo(0.12, 5);
    expect(par.state).toBe('succeeded');
    expect(entrante.packetsReceived).toBe(100);
    expect(entrante.packetsLost).toBe(1);
    expect(entrante.bytesReceived).toBe(8000);
  });

  it('los contadores se acumulan entre muestras, y con bytes:0 se quedan planos', async () => {
    const pc = new RTCPeerConnection();
    pc.__simular({ bytes: 8000 });
    pc.__simular({ bytes: 8000 });
    let entrante = [...(await pc.getStats()).values()].find(e => e.type === 'inbound-rtp');
    expect(entrante.bytesReceived).toBe(16000);
    expect(entrante.packetsReceived).toBe(200);

    pc.__simular({ bytes: 0 });
    entrante = [...(await pc.getStats()).values()].find(e => e.type === 'inbound-rtp');
    expect(entrante.bytesReceived).toBe(16000);
  });

  it('se puede quitar getStats o hacer que reviente', async () => {
    const sinEllas = new RTCPeerConnection();
    sinEllas.__sinGetStats();
    expect(typeof sinEllas.getStats).not.toBe('function');

    const rotas = new RTCPeerConnection();
    rotas.__getStatsFalla();
    await expect(rotas.getStats()).rejects.toThrow();
  });

  it('la máquina de señalización se mueve como la del navegador', async () => {
    const pc = new RTCPeerConnection();
    expect(pc.signalingState).toBe('stable');

    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    expect(pc.signalingState).toBe('have-local-offer');
    expect(pc.localDescription.type).toBe('offer');

    await pc.setRemoteDescription({ type: 'answer', sdp: 'x' });
    expect(pc.signalingState).toBe('stable');
    expect(pc.remoteDescription.type).toBe('answer');
  });

  it('una respuesta fuera de have-local-offer LANZA, como en el navegador', async () => {
    // Es lo que protege la guarda de la negociación perfecta. Si el doble se lo
    // tragara, esa guarda no estaría cubierta por nada.
    const pc = new RTCPeerConnection();
    await expect(pc.setRemoteDescription({ type: 'answer', sdp: 'x' })).rejects.toThrow();
  });

  it('una oferta remota durante la colisión SÍ se acepta (rollback implícito)', async () => {
    const pc = new RTCPeerConnection();
    await pc.setLocalDescription(await pc.createOffer());
    await expect(pc.setRemoteDescription({ type: 'offer', sdp: 'x' })).resolves.toBeUndefined();
    expect(pc.signalingState).toBe('have-remote-offer');
  });

  it('los candidatos antes de la descripción remota se rechazan, y después se aceptan', async () => {
    const pc = new RTCPeerConnection();
    await expect(pc.addIceCandidate({ candidate: 'c' })).rejects.toThrow();

    await pc.setRemoteDescription({ type: 'offer', sdp: 'x' });
    await pc.addIceCandidate({ candidate: 'c' });
    expect(pc.__candidatosAnadidos).toHaveLength(1);
  });

  it('addTrack devuelve un sender que getSenders sí enseña', () => {
    const pc = new RTCPeerConnection();
    const stream = globalThis.__mediaDevices.crearStream({ audio: 1 });
    const sender = pc.addTrack(stream.getAudioTracks()[0], stream);
    expect(pc.getSenders()).toEqual([sender]);
    pc.removeTrack(sender);
    expect(pc.getSenders()).toEqual([]);
  });

  it('el registro de instancias dice cuáles siguen abiertas', () => {
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    expect(RTCPeerConnection.__todas()).toEqual([a, b]);
    expect(RTCPeerConnection.__ultima()).toBe(b);
    a.close();
    expect(RTCPeerConnection.__abiertas()).toEqual([b]);
  });

  it('el registro se vacía entre casos (si no, contar pares no significaría nada)', () => {
    expect(RTCPeerConnection.__todas()).toEqual([]);
  });
});

describe('banco · medios', () => {
  it('por defecto getUserMedia rechaza y enumerateDevices no existe', async () => {
    expect(navigator.mediaDevices.enumerateDevices).toBeUndefined();
    await expect(navigator.mediaDevices.getUserMedia({ audio: true })).rejects.toThrow();
  });

  it('darStream fabrica las pistas que piden las restricciones', async () => {
    globalThis.__mediaDevices.darStream();
    const soloAudio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    expect(soloAudio.getAudioTracks()).toHaveLength(1);
    expect(soloAudio.getVideoTracks()).toHaveLength(0);

    const conCamara = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    expect(conCamara.getVideoTracks()).toHaveLength(1);
  });

  it('fallarCon reproduce la taxonomía de errores del micrófono', async () => {
    globalThis.__mediaDevices.fallarCon('NotReadableError');
    await expect(navigator.mediaDevices.getUserMedia({ audio: true }))
      .rejects.toMatchObject({ name: 'NotReadableError' });
  });

  it('colgar deja getUserMedia sin resolver, que es como se prueba el tope de espera', async () => {
    globalThis.__mediaDevices.colgar();
    let resuelto = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(() => { resuelto = true; });
    await Promise.resolve();
    expect(resuelto).toBe(false);
  });

  it('las restricciones pedidas quedan registradas', async () => {
    globalThis.__mediaDevices.darStream();
    await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: 'mic-1' } }, video: false });
    expect(globalThis.__mediaDevices.llamadas()[0].audio.deviceId).toEqual({ exact: 'mic-1' });
  });

  it('conDispositivos declara enumerateDevices y emitirDeviceChange avisa a los dos tipos de oyente', async () => {
    globalThis.__mediaDevices.conDispositivos([{ deviceId: 'mic-1', kind: 'audioinput', label: 'Auriculares' }]);
    expect(await navigator.mediaDevices.enumerateDevices()).toHaveLength(1);

    let porPropiedad = 0;
    let porOyente = 0;
    navigator.mediaDevices.ondevicechange = () => { porPropiedad += 1; };
    navigator.mediaDevices.addEventListener('devicechange', () => { porOyente += 1; });

    globalThis.__mediaDevices.emitirDeviceChange();
    expect(porPropiedad).toBe(1);
    expect(porOyente).toBe(1);
  });

  it('la ausencia de enumerateDevices vuelve sola en el caso siguiente', () => {
    expect(navigator.mediaDevices.enumerateDevices).toBeUndefined();
  });

  it('parar un stream marca sus pistas', () => {
    const stream = globalThis.__mediaDevices.crearStream({ audio: 1, video: 1 });
    expect(stream.getTracks()).toHaveLength(2);
    stream.getTracks().forEach(p => p.stop());
    expect(stream.getTracks().every(p => p.__parada)).toBe(true);
    expect(stream.active).toBe(false);
  });
});

describe('banco · audio', () => {
  it('el nivel que se pide es el RMS que lee el analizador', async () => {
    const { rmsDe } = await import('../voice/vad');
    globalThis.__audio.nivel(0.5);
    const ctx = new window.AudioContext();
    const analizador = ctx.createAnalyser();
    const muestras = new Uint8Array(128);
    analizador.getByteTimeDomainData(muestras);
    expect(rmsDe(muestras)).toBeCloseTo(0.5, 2);
  });

  it('un contexto puede nacer suspendido y contar sus resume()', async () => {
    globalThis.__audio.nacerSuspendido();
    const ctx = new window.AudioContext();
    expect(ctx.state).toBe('suspended');
    await ctx.resume();
    expect(ctx.state).toBe('running');
    expect(ctx.__resumes).toBe(1);
  });

  it('los osciladores dejan rastro de sus frecuencias', () => {
    const ctx = new window.AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(660, 0);
    osc.frequency.setValueAtTime(880, 0.18);
    osc.start(0);
    expect(globalThis.__audio.osciladores()).toHaveLength(1);
    expect(osc.__frecuencias).toEqual([660, 880]);
    expect(osc.__iniciado).toBe(0);
  });
});

describe('banco · vibración', () => {
  it('está ausente por defecto, como en jsdom', () => {
    expect(navigator.vibrate).toBeUndefined();
  });

  it('activada, apunta los patrones pedidos', () => {
    globalThis.__vibracion.activar();
    navigator.vibrate([120, 80, 120]);
    navigator.vibrate(10);
    expect(globalThis.__vibracion.pulsos()).toEqual([[120, 80, 120], 10]);
  });

  it('vuelve a estar ausente en el caso siguiente', () => {
    expect(navigator.vibrate).toBeUndefined();
    expect(globalThis.__vibracion.pulsos()).toEqual([]);
  });
});

describe('banco · tiempo', () => {
  // A propósito SIN devolver los relojes al final: el caso siguiente comprueba
  // que la red del afterEach los devuelve igualmente.
  it('los temporizadores falsos avanzan también Date.now()', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let disparos = 0;
    const id = setInterval(() => { disparos += 1; }, 100);

    vi.advanceTimersByTime(1000);

    expect(disparos).toBe(10);
    expect(Date.now()).toBe(1000);
    clearInterval(id);
  });

  it('el afterEach devuelve los relojes de verdad aunque el caso anterior no lo hiciera', () => {
    // Sin esta red, un `useFakeTimers()` olvidado envenena todo lo que venga
    // detrás en el mismo worker y el síntoma aparece en un fichero ajeno. Si los
    // relojes hubiesen sobrevivido, aquí seguiríamos en el epoch del caso de
    // arriba (1000), no en la fecha de hoy.
    expect(Date.now()).toBeGreaterThan(1_700_000_000_000);
  });
});

describe('banco · fetch', () => {
  it('/ice-config responde con turnMode, que es lo que ramifica el copy', async () => {
    const res = await fetch('http://test.local/ice-config');
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ iceServers: [], turnMode: 'free-fallback', turnConfigured: false });
    expect(globalThis.__fetch.ultimaUrl()).toBe('http://test.local/ice-config');
  });

  it('la ruta vieja /api/turn-credentials devuelve 404, que es la verdad del servidor', async () => {
    const res = await fetch('/api/turn-credentials');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('iceConfig cambia el turnMode para probar la otra rama del copy', async () => {
    globalThis.__fetch.iceConfig({ turnMode: 'cloudflare', turnConfigured: true });
    const datos = await (await fetch('/ice-config')).json();
    expect(datos.turnMode).toBe('cloudflare');
  });

  it('el turnMode vuelve a su valor por defecto en el caso siguiente', async () => {
    const datos = await (await fetch('/ice-config')).json();
    expect(datos.turnMode).toBe('free-fallback');
    expect(globalThis.__fetch.llamadas()).toHaveLength(1);
  });
});
