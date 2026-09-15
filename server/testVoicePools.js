// Pruebas de la voz: pools por cuenta, consentimiento, reenganche y
// señalización.
//
// Por qué existe: hasta ahora NINGUNA de las 23 suites mencionaba `voice_pool`,
// `call_friend` ni `voiceHandler`. Las ~320 líneas del handler no tenían ni una
// aserción, y el verde de la suite no protegía nada de esta área. Aquí se cubre
// lo que rompe de verdad: quién puede entrar en una línea ajena, qué pasa
// cuando el móvil se reconecta y qué sale hacia una sala.
//
// El bloque final es la VERIFICACIÓN DE TOLERANCIA: el cliente ACTUAL, sin un
// solo cambio, contra este servidor. Si deja de pasar, el despliegue del
// servidor y el del cliente pasan a ser un único commit atómico, que es
// exactamente lo que el plan evita.

// Margen de gracia corto SOLO en este proceso (las pruebas puras de expiración
// no pueden esperar medio minuto). El servidor hijo arranca con el valor real.
process.env.VOZ_GRACIA_MS = '250';

const assert = require('assert');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const linea = require('./voicePools');
const politica = require('./voicePolicy');

const PORT = Number(process.env.TEST_PORT_VOZ) || 3988;
const URL = `http://localhost:${PORT}`;

let server;
let fallos = 0;

function ok(msg) { console.log(`✓ ${msg}`); }
function comprobar(cond, msg) {
  try { assert.ok(cond, msg); ok(msg); } catch (e) { fallos++; console.error(`✗ ${msg}`); }
}

const pausa = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════
// PARTE A — lógica pura (sin red, sin base de datos)
// ═══════════════════════════════════════════════════════════════════════

function pruebasPuras() {
  console.log('\n--- voicePools: pertenencia por cuenta ---');
  linea._reset();

  const p = linea.crearPool({ tipo: 'privado', roomId: null });
  linea.entrar(p.poolId, { cuentaId: 'p_a', name: 'Ana', sesionId: 's1' });
  linea.entrar(p.poolId, { cuentaId: 'p_b', name: 'Beto', sesionId: 's2' });

  comprobar(linea.poolDeCuenta('p_a') === p, 'el índice inverso encuentra la línea de una cuenta');
  comprobar(linea.miembrosPublicos(p).every(m => m.estado === 'presente'), 'los dos miembros están presentes');
  comprobar(!JSON.stringify(linea.miembrosPublicos(p)).includes('s1'),
    'la vista pública NO lleva el socketId de nadie');

  // Una cuenta no puede estar en dos líneas a la vez.
  const otro = linea.crearPool({ tipo: 'privado', roomId: null });
  const res = linea.entrar(otro.poolId, { cuentaId: 'p_a', name: 'Ana', sesionId: 's1' });
  comprobar(res && res.salioDe && res.salioDe.poolId === p.poolId,
    'entrar en otra línea saca a la cuenta de la anterior (UN pool por cuenta)');
  comprobar(!p.miembros.has('p_a'), 'y deja de figurar en la primera');

  // Toma de relevo: otra pestaña de la MISMA cuenta.
  const relevo = linea.entrar(otro.poolId, { cuentaId: 'p_a', name: 'Ana', sesionId: 's9' });
  comprobar(relevo.relevado === 's1', 'una segunda pestaña releva a la anterior y la delata para desmontarla');
  comprobar(otro.miembros.get('p_a').sesionId === 's9', 'la sesión ligada pasa a ser la nueva');

  // Tope duro: la malla es completa y el séptimo no cabe.
  linea._reset();
  const lleno = linea.crearPool({ tipo: 'privado', roomId: null });
  for (let i = 0; i < linea.TOPE_MIEMBROS; i++) {
    linea.entrar(lleno.poolId, { cuentaId: `p_${i}`, name: `J${i}`, sesionId: `s${i}` });
  }
  comprobar(linea.entrar(lleno.poolId, { cuentaId: 'p_extra', name: 'Extra', sesionId: 'sx' }) === null,
    `el miembro nº ${linea.TOPE_MIEMBROS + 1} se rechaza (tope duro de la malla)`);

  console.log('\n--- voicePools: reenganche y margen de gracia ---');
  linea._reset();
  const g = linea.crearPool({ tipo: 'privado', roomId: null });
  linea.entrar(g.poolId, { cuentaId: 'p_movil', name: 'Ana', sesionId: 's_viejo' });
  linea.entrar(g.poolId, { cuentaId: 'p_fijo', name: 'Beto', sesionId: 's_fijo' });

  const marca = linea.marcarAusente('s_viejo');
  comprobar(marca && marca.cuenta === 'p_movil', 'al caerse el socket se identifica a quién pertenecía');
  comprobar(g.miembros.has('p_movil'), 'el miembro NO se borra: la reconexión es lo normal en móvil');
  comprobar(linea.miembrosPublicos(g).find(m => m.playerId === 'p_movil').estado === 'ausente',
    'y se difunde como ausente, no como ido');

  comprobar(linea.reenganchar('p_movil', 's_nuevo') === 'ok', 'vuelve dentro del margen y recupera su sitio');
  comprobar(g.miembros.get('p_movil').sesionId === 's_nuevo', 'con la pestaña nueva ligada');
  comprobar(linea.instantanea().reenganchesOk === 1, 'el reenganche queda contado para poder ajustar el margen');

  comprobar(linea.reenganchar('p_movil', 'otra_pestana_mas') === 'otra_pestana',
    'con una pestaña VIVA distinta, la nueva no roba la voz: se le dice que ya está en otra');
  comprobar(linea.reenganchar('p_nadie', 's') === 'sin_pool', 'quien no está en ninguna línea lo sabe');

  return new Promise((resolve) => {
    let expirado = null;
    linea.marcarAusente('s_fijo', (cuenta, pool) => { expirado = { cuenta, pool }; });
    setTimeout(() => {
      comprobar(expirado && expirado.cuenta === 'p_fijo', 'al vencer el margen se avisa de quién se ha ido');
      comprobar(!g.miembros.has('p_fijo'), 'y AHORA sí se le retira de la línea');
      comprobar(linea.instantanea().graciasExpiradas === 1,
        'las expiraciones también se cuentan: si dominan, el margen sobra');
      linea._reset();
      resolve();
    }, 500);
  });
}

async function pruebasDePolitica() {
  console.log('\n--- voicePolicy: consentimiento ---');
  politica._reset();

  const base = {
    hayPersistencia: () => false,
    sonAmigos: () => false,
    mismaMesa: () => false,
    estaEnLinea: () => true,
    disponibilidadDe: () => 'libre'
  };

  comprobar((await politica.puedeLlamar('p_a', 'p_a', base)).code === 'a_ti_mismo',
    'llamarse a uno mismo se rechaza');

  comprobar((await politica.puedeLlamar('p_a', 'p_b', base)).ok === true,
    'SIN persistencia se permite llamar: es el modo por defecto de cualquier clon del repo');

  const conBd = { ...base, hayPersistencia: () => true };
  comprobar((await politica.puedeLlamar('p_a', 'p_b', conBd)).code === 'no_amigos',
    'CON persistencia se exige amistad (la asimetría es deliberada, no un olvido)');

  comprobar((await politica.puedeLlamar('p_a', 'p_b', { ...conBd, sonAmigos: () => true })).ok === true,
    'un amigo sí puede llamar');
  comprobar((await politica.puedeLlamar('p_a', 'p_b', { ...conBd, mismaMesa: () => true })).ok === true,
    'y quien comparte mesa también, aunque no sea amigo');

  comprobar((await politica.puedeLlamar('p_a', 'p_b', { ...base, disponibilidadDe: () => 'no_molestar' })).code === 'no_molestar',
    '«no molestar» corta la llamada antes que cualquier otra regla');
  comprobar((await politica.puedeLlamar('p_a', 'p_b', { ...base, estaEnLinea: () => false })).code === 'desconectado',
    'a quien no está conectado se le responde «desconectado», no un silencio eterno');

  // ─── Enfriamiento por pareja ───
  politica._reset();
  const t0 = 1_000_000;
  politica.registrarTimbre('p_a', 'p_b', t0);
  comprobar((await politica.puedeLlamar('p_a', 'p_b', { ...base, ahora: t0 + 1000 })).code === 'enfriamiento',
    'no se puede timbrar dos veces seguidas al mismo destino (20 s)');
  comprobar((await politica.puedeLlamar('p_a', 'p_b', { ...base, ahora: t0 + 25000 })).ok === true,
    'pasados los 20 s se puede volver a llamar');
  comprobar((await politica.puedeLlamar('p_a', 'p_c', { ...base, ahora: t0 + 1000 })).ok === true,
    'el enfriamiento es POR PAREJA: llamar a otra persona no está penalizado');

  politica._reset();
  politica.registrarTimbre('p_a', 'p_b', t0);
  politica.registrarRechazo('p_a', 'p_b', t0);
  comprobar((await politica.puedeLlamar('p_a', 'p_b', { ...base, ahora: t0 + 60000 })).code === 'enfriamiento',
    'tras un rechazo hay cinco minutos de silencio (es lo único que ataca el acoso)');

  // La regla socialmente correcta: si quien rechazó devuelve la llamada, el
  // enfriamiento se cancela. Sin esto, dos amigos que se rechazaron sin querer
  // se topan con un bug con forma de política.
  politica.registrarTimbre('p_b', 'p_a', t0 + 61000);
  comprobar((await politica.puedeLlamar('p_a', 'p_b', { ...base, ahora: t0 + 62000 })).ok === true,
    'si quien rechazó devuelve la llamada, el enfriamiento se cancela');

  politica._reset();
}

// ═══════════════════════════════════════════════════════════════════════
// PARTE B — integración contra el servidor real
// ═══════════════════════════════════════════════════════════════════════

function arrancarServidor() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      // Modo degradado, igual que testHandlers.js. DATABASE_URL se borra
      // EXPLÍCITAMENTE y no por omisión: server.js carga server/.env, así que
      // en la máquina de quien tenga una configurada esta suite se pondría a
      // hablar con la base de datos REAL —cambiando el resultado y, peor,
      // escribiendo en ella—. La clave tiene que EXISTIR aunque valga vacío:
      // dotenv sólo rellena las que faltan.
      // VOZ_GRACIA_MS se manda vacío para que el hijo use el margen de verdad:
      // el corto de este proceso es solo para las pruebas puras de arriba.
      env: {
        ...process.env,
        DATABASE_URL: '',
        VOZ_GRACIA_MS: '',
        PORT: String(PORT),
        AUTH_SECRET: 'test_secret_voz'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const alTiempo = setTimeout(() => reject(new Error('el servidor no arrancó a tiempo')), 20000);
    server.stdout.on('data', (b) => {
      if (b.toString().includes('Servidor corriendo')) {
        clearTimeout(alTiempo);
        resolve();
      }
    });
    server.on('error', reject);
  });
}

const conectar = () => new Promise((res, rej) => {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  s.on('connect', () => res(s));
  s.on('connect_error', rej);
});

const esperar = (s, ev, ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`no llegó '${ev}'`)), ms);
  s.once(ev, (d) => { clearTimeout(t); res(d); });
});

const quizas = (s, ev, ms = 900) => Promise.race([
  new Promise(r => s.once(ev, r)),
  pausa(ms).then(() => null)
]);

/** Conecta, hace el handshake de identidad y saluda a la voz. */
async function jugador(id) {
  const s = await conectar();
  s.emit('hello', { playerId: id });
  const sesion = await esperar(s, 'session');
  s.emit('voice_hello');
  await quizas(s, 'voice_state', 1500);
  s.cuenta = id;
  s.token = sesion.token;
  s.sesion = sesion;
  return s;
}

const salud = async () => (await fetch(`${URL}/health`)).json();

let n = 0;
const nuevoId = (etiqueta) => `p_${etiqueta}_${++n}`;

async function pruebasDeIntegracion() {
  // ── 1. El ciclo feliz de punta a punta ────────────────────────────────
  console.log('\n--- ciclo llamar → timbrar → aceptar → hablar → colgar ---');
  {
    const ana = await jugador(nuevoId('ana'));
    const beto = await jugador(nuevoId('beto'));

    ana.emit('create_room', { name: 'Ana', isPublic: false });
    await esperar(ana, 'room_created');

    const timbre = esperar(beto, 'incoming_call');
    const saliente = esperar(ana, 'call_outgoing');
    ana.emit('call_friend', { targetPlayerId: beto.cuenta });
    const entrante = await timbre;
    const fuera = await saliente;

    comprobar(entrante.callId && entrante.fromPlayerId === ana.cuenta,
      'call_friend hace sonar el teléfono del destino');
    comprobar(entrante.fromName === 'Ana',
      'el nombre lo pone el SERVIDOR (antes viajaba sin validar en el payload hasta un <h4>)');
    comprobar(entrante.poolId === undefined,
      'incoming_call ya NO lleva poolId: quien recibe un timbre no se queda una llave');
    comprobar(entrante.tipo === 'directa' && typeof entrante.expiraEn === 'number',
      'el timbre dice de qué tipo es y cuándo expira (la cuenta atrás es real)');
    comprobar(fuera.targetName === 'Jugador' || typeof fuera.targetName === 'string',
      'call_outgoing devuelve a quién se está llamando');

    const unido = esperar(beto, 'voice_pool_joined');
    const aceptada = esperar(ana, 'call_accepted');
    const actualizado = esperar(ana, 'voice_pool_updated');
    beto.emit('accept_call', { callId: entrante.callId });
    const pool = await unido;
    await aceptada;
    const upd = await actualizado;

    comprobar(pool.miembros.length === 2, 'aceptar mete a los dos en la misma línea');
    comprobar(Array.isArray(pool.members) && pool.members.length === 2,
      'y `members` sigue viajando junto a `miembros` (ventana de tolerancia con el cliente actual)');
    comprobar(upd.poolId === pool.poolId, 'el llamante recibe el pool por voice_pool_updated');

    // Señalización: llega SOLO a la pestaña ligada del destinatario.
    const senal = esperar(beto, 'voice_pool_signal');
    ana.emit('voice_pool_signal', {
      toPlayerId: beto.cuenta,
      signal: { description: { type: 'offer', sdp: 'v=0\r\n' } }
    });
    const recibida = await senal;
    comprobar(recibida.fromPlayerId === ana.cuenta && recibida.signal.description.type === 'offer',
      'la señalización WebRTC llega al otro extremo con el emisor correcto');
    comprobar(recibida.poolId === undefined, 'y sin poolId: el destino ya sabe en qué línea está');

    // Un `signal` que no case con el esquema se descarta sin reenviarse.
    const basura = quizas(beto, 'voice_pool_signal', 600);
    ana.emit('voice_pool_signal', { toPlayerId: beto.cuenta, signal: { description: { type: 'hackeo' } } });
    comprobar((await basura) === null, 'un `signal` que no valida NO se reenvía al navegador de nadie');

    const hablando = esperar(beto, 'voice_pool_speaking');
    ana.emit('voice_pool_speaking', { speaking: true });
    const habla = await hablando;
    comprobar(habla.playerId === ana.cuenta && habla.speaking === true,
      'el indicador de quién habla viaja con el id de cuenta');

    const cerrado = esperar(beto, 'voice_pool_updated');
    ana.emit('end_call', {});
    const tras = await cerrado;
    comprobar(tras.miembros.length <= 1,
      'al colgar, el que queda ve la línea con un solo miembro (así puede cerrarla de verdad)');

    ana.close(); beto.close();
  }

  // ── 2. Los agujeros de pertenencia ───────────────────────────────────
  console.log('\n--- consentimiento: quién puede entrar en una línea ---');
  {
    const uno = await jugador(nuevoId('uno'));
    const dos = await jugador(nuevoId('dos'));
    const colado = await jugador(nuevoId('colado'));

    const timbre = esperar(dos, 'incoming_call');
    uno.emit('call_friend', { targetPlayerId: dos.cuenta });
    const entrante = await timbre;

    // El intruso conoce el callId (o se lo inventa) y prueba con un poolId.
    const entra = quizas(colado, 'voice_pool_joined', 900);
    colado.emit('accept_call', { callId: entrante.callId, poolId: 'vpool_lo_que_sea', name: 'Colado' });
    comprobar((await entra) === null,
      'aceptar una llamada que NO era para ti no te mete en la línea (antes ganaba el poolId del payload)');

    const antes = (await salud()).voz.lineas;
    const err = esperar(colado, 'call_error');
    colado.emit('accept_call', { callId: 'call_inventado', poolId: 'vpool_inventado' });
    const e = await err;
    const despues = (await salud()).voz.lineas;
    comprobar(e.code === 'no_existe', 'un callId inventado responde con un código, no con español duro');
    comprobar(antes === despues, 'accept_call NUNCA crea pools (antes se creaba el que le pidieran)');

    // Invitar sin pertenecer a la línea.
    const invitado = quizas(dos, 'incoming_call', 900);
    colado.emit('invite_to_pool', { targetPlayerId: dos.cuenta, poolId: 'vpool_lo_que_sea' });
    comprobar((await invitado) === null,
      'invitar a un pool al que no perteneces no hace sonar nada');

    // Cancelar apaga el timbre del destino.
    const cancelado = esperar(dos, 'call_cancelled');
    uno.emit('call_cancel', { callId: entrante.callId });
    const c = await cancelado;
    comprobar(c.callId === entrante.callId && c.motivo === 'colgo',
      'call_cancel apaga el timbre del destino (antes cancelar era imposible)');

    // Y otro no puede cancelar la llamada de un tercero.
    const timbre2 = esperar(dos, 'incoming_call');
    uno.emit('call_friend', { targetPlayerId: dos.cuenta });
    // el enfriamiento de 20 s obliga a esperar: se usa otra pareja
    const otroLlamante = await jugador(nuevoId('otro'));
    const timbre3 = esperar(dos, 'incoming_call');
    otroLlamante.emit('call_friend', { targetPlayerId: dos.cuenta });
    const t3 = await Promise.race([timbre3, timbre2]);
    const ajeno = quizas(dos, 'call_cancelled', 700);
    colado.emit('call_cancel', { callId: t3.callId });
    comprobar((await ajeno) === null, 'nadie puede cancelar el timbre de otro');

    uno.close(); dos.close(); colado.close(); otroLlamante.close();
  }

  // ── 3. Señalizar fuera del propio pool ───────────────────────────────
  console.log('\n--- aislamiento entre líneas ---');
  {
    const a1 = await jugador(nuevoId('a1'));
    const a2 = await jugador(nuevoId('a2'));
    const b1 = await jugador(nuevoId('b1'));
    const b2 = await jugador(nuevoId('b2'));

    let t = esperar(a2, 'incoming_call');
    a1.emit('call_friend', { targetPlayerId: a2.cuenta });
    let e = await t;
    a2.emit('accept_call', { callId: e.callId });
    await esperar(a2, 'voice_pool_joined');

    t = esperar(b2, 'incoming_call');
    b1.emit('call_friend', { targetPlayerId: b2.cuenta });
    e = await t;
    b2.emit('accept_call', { callId: e.callId });
    await esperar(b2, 'voice_pool_joined');

    const cruzada = quizas(a2, 'voice_pool_signal', 900);
    b1.emit('voice_pool_signal', {
      toPlayerId: a2.cuenta,
      signal: { candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 1 typ host' } }
    });
    comprobar((await cruzada) === null,
      'señalizar a alguien de OTRA línea se descarta: el pool se deriva de la pertenencia');

    const cruzadaHabla = quizas(a2, 'voice_pool_speaking', 700);
    b1.emit('voice_pool_speaking', { speaking: true });
    comprobar((await cruzadaHabla) === null, 'y el indicador de habla tampoco cruza de línea');

    a1.close(); a2.close(); b1.close(); b2.close();
  }

  // ── 4. Dos pestañas de la misma cuenta ───────────────────────────────
  console.log('\n--- una sola sesión de voz por cuenta ---');
  {
    const quien = nuevoId('doble');
    const p1 = await jugador(quien);
    const s2 = await conectar();
    s2.emit('hello', { playerId: quien, token: p1.token });
    await esperar(s2, 'session');
    s2.emit('voice_hello');
    await quizas(s2, 'voice_state', 1200);

    const llamante = await jugador(nuevoId('llamante'));

    const t1 = esperar(p1, 'incoming_call');
    const t2 = esperar(s2, 'incoming_call');
    llamante.emit('call_friend', { targetPlayerId: quien });
    const e1 = await t1;
    await t2;
    comprobar(true, 'el timbre SÍ se reparte a todas las pestañas (un teléfono suena en todas partes)');

    const hermanaCancelada = esperar(p1, 'call_cancelled');
    s2.emit('accept_call', { callId: e1.callId });
    const pool = await esperar(s2, 'voice_pool_joined');
    const cancel = await hermanaCancelada;
    comprobar(pool.miembros.some(m => m.playerId === quien), 'la pestaña que contesta es la que entra en la línea');
    comprobar(cancel.motivo === 'atendida_en_otra_pestana',
      'la hermana deja de sonar y se le dice por qué');

    // La tercera pestaña que llegue se lleva el relevo y la anterior se entera.
    const relevada = esperar(s2, 'voice_taken');
    const s3 = await conectar();
    s3.emit('hello', { playerId: quien, token: p1.token });
    await esperar(s3, 'session');
    const llamante2 = await jugador(nuevoId('llamante2'));
    const t3 = esperar(s3, 'incoming_call');
    llamante2.emit('call_friend', { targetPlayerId: quien });
    const e3 = await t3;
    s3.emit('accept_call', { callId: e3.callId });
    await relevada;
    comprobar(true, 'al tomar la voz otra pestaña, la anterior recibe voice_taken y se desmonta');

    p1.close(); s2.close(); s3.close(); llamante.close(); llamante2.close();
  }

  // ── 4b. Llamada en espera: rechazar desde otra pestaña no cuelga la de aquí ──
  {
    const yo = nuevoId('espera');
    const hablando = await jugador(yo);
    const ocioso = await conectar();
    ocioso.emit('hello', { playerId: yo, token: hablando.token });
    await esperar(ocioso, 'session');

    const amigo = await jugador(nuevoId('amigoEspera'));
    let t = esperar(hablando, 'incoming_call');
    amigo.emit('call_friend', { targetPlayerId: yo });
    let e = await t;
    hablando.emit('accept_call', { callId: e.callId });
    await esperar(hablando, 'voice_pool_joined');

    // Entra una segunda llamada y la rechazo desde la pestaña ociosa.
    const intruso = await jugador(nuevoId('intruso'));
    t = esperar(ocioso, 'incoming_call');
    intruso.emit('call_friend', { targetPlayerId: yo });
    e = await t;

    // Los dos oyentes se registran ANTES de emitir: si no, el rechazo llega
    // mientras se espera al primero y el segundo no lo ve nunca.
    const cortada = quizas(hablando, 'voice_taken', 1000);
    const rechazo = quizas(intruso, 'call_declined', 1000);
    ocioso.emit('decline_call', { callId: e.callId });
    comprobar((await cortada) === null,
      'rechazar desde una pestaña ociosa NO manda voice_taken a la que está hablando (no corta la llamada en curso)');
    comprobar((await rechazo) !== null,
      'y el que llamaba sí se entera de que le han rechazado');

    hablando.close(); ocioso.close(); amigo.close(); intruso.close();
  }

  // ── 5. Reconexión: ausente y reenganche ──────────────────────────────
  console.log('\n--- reconexión: el fallo número uno en móvil ---');
  {
    const movil = nuevoId('movil');
    const m1 = await jugador(movil);
    const fijo = await jugador(nuevoId('fijo'));

    const t = esperar(fijo, 'incoming_call');
    m1.emit('call_friend', { targetPlayerId: fijo.cuenta });
    const e = await t;
    const ausencia = esperar(fijo, 'voice_pool_updated');
    fijo.emit('accept_call', { callId: e.callId });
    await ausencia;
    await esperar(fijo, 'voice_pool_joined').catch(() => {});

    const reenganchesAntes = (await salud()).voz.reenganchesOk;

    const cambio = esperar(fijo, 'voice_pool_updated', 4000);
    m1.close();                       // se le cae la red al móvil
    const conAusente = await cambio;
    const yo = conAusente.miembros.find(x => x.playerId === movil);
    comprobar(yo && yo.estado === 'ausente',
      'al caerse el socket, el miembro queda AUSENTE en vez de desaparecer de la llamada');

    const m2 = await conectar();
    m2.emit('hello', { playerId: movil, token: m1.token });
    await esperar(m2, 'session');
    m2.emit('voice_hello');
    const estado = await esperar(m2, 'voice_state');

    comprobar(estado.pool && estado.pool.miembros.length === 2,
      'voice_hello devuelve la línea entera: el cliente puede reconstruir los pares');
    comprobar(estado.enOtraPestana === false, 'y sabe que no es un caso de «estás en otra pestaña»');
    comprobar((await salud()).voz.reenganchesOk === reenganchesAntes + 1,
      'el reenganche queda instrumentado en /health para poder ajustar el margen');

    m2.close(); fijo.close();
  }

  // ── 6. voice_hello sin línea ─────────────────────────────────────────
  {
    const solo = await conectar();
    solo.emit('hello', { playerId: nuevoId('solo') });
    await esperar(solo, 'session');
    solo.emit('voice_hello');
    const st = await esperar(solo, 'voice_state');
    comprobar(st.pool === null && st.enOtraPestana === false && Array.isArray(st.timbrando),
      'sin llamada en curso, voice_state dice que no hay nada (y no un silencio que el cliente tenga que adivinar)');
    solo.close();
  }

  // ── 7. La voz de la mesa: aliasada y con guarda de asiento ───────────
  console.log('\n--- voz de la mesa: nada con ámbito de sala lleva un id de cuenta ---');
  {
    const anfitrion = await jugador(nuevoId('anfitrion'));
    const invitado = await jugador(nuevoId('invitado'));
    const deFuera = await jugador(nuevoId('defuera'));

    anfitrion.emit('create_room', { name: 'Anfitrion', isPublic: true });
    const sala = await esperar(anfitrion, 'room_created');
    invitado.emit('join_room', { roomId: sala.roomId, name: 'Invitado' });
    await esperar(invitado, 'room_joined');

    const enMesa = esperar(invitado, 'table_voice');
    anfitrion.emit('join_table_voice', {});
    const tv = await enMesa;

    comprobar(Array.isArray(tv.alias) && tv.alias.length === 1 && tv.alias[0].startsWith('s_'),
      'table_voice llega ALIASADO a la sala');
    comprobar(!JSON.stringify(tv).includes('p_'),
      'y no contiene ningún id de cuenta (el id persistente no sale de la sala)');

    // Un amigo que NO está sentado se suma a la voz de la mesa: cuenta para `n`
    // pero NO se le acuña un alias forastero en la tabla de esa sala.
    const t = esperar(deFuera, 'incoming_call');
    anfitrion.emit('call_friend', { targetPlayerId: deFuera.cuenta });
    const e = await t;
    const conForastero = esperar(invitado, 'table_voice');
    deFuera.emit('accept_call', { callId: e.callId });
    const tv2 = await conForastero;

    comprobar(tv2.n === 2, '«n» cuenta a todos los de la línea, también a quien no está sentado');
    comprobar(tv2.alias.length === 1,
      'pero solo se aliasa a quien SÍ tiene asiento (la guarda de emitirAMesa)');
    comprobar(!JSON.stringify(tv2).includes(deFuera.cuenta),
      'y el id del forastero no viaja a la sala por ningún hueco');

    const hablaEnMesa = esperar(invitado, 'table_speaking');
    anfitrion.emit('voice_pool_speaking', { speaking: true });
    const ts = await hablaEnMesa;
    comprobar(Array.isArray(ts.alias) && ts.alias[0].startsWith('s_') && ts.speaking === true,
      'table_speaking también sale aliasado');

    // Vaciar la voz de la mesa TIENE que llegar a la sala. Si el aviso solo se
    // difundiera cuando queda alguien dentro, el chip de la partida seguiría
    // diciendo «en la voz» para siempre, sin nadie al otro lado.
    const seVa = esperar(invitado, 'table_voice');
    anfitrion.emit('end_call', {});
    const tv3 = await seVa;
    comprobar(tv3.n === 1 && tv3.alias.length === 0,
      'al colgar el único sentado, la sala se entera de que ya no hay nadie suyo en la voz');

    const vacia = esperar(invitado, 'table_voice');
    deFuera.emit('end_call', {});
    const tv4 = await vacia;
    comprobar(tv4.n === 0 && tv4.alias.length === 0,
      'y cuando la línea de la mesa se queda vacía, la sala también recibe el cero');

    // El mismo aviso, por el camino de SALIDA LATERAL: aceptar una llamada
    // privada te saca de la voz de la mesa. Ese camino no pasa por `end_call`,
    // y si no difundiera al vaciarse el pool, la sala se quedaría anunciando a
    // alguien que ya está hablando en otro sitio.
    const solo = esperar(invitado, 'table_voice');
    anfitrion.emit('join_table_voice', {});
    comprobar((await solo).n === 1, 'el anfitrión vuelve a entrar solo a la voz de la mesa');

    const raptor = await jugador(nuevoId('raptor'));
    const t3 = esperar(anfitrion, 'incoming_call');
    raptor.emit('call_friend', { targetPlayerId: anfitrion.cuenta });
    const e3 = await t3;
    const seVacia = esperar(invitado, 'table_voice');
    anfitrion.emit('accept_call', { callId: e3.callId });
    const tv5 = await seVacia;
    comprobar(tv5.n === 0 && tv5.alias.length === 0,
      'irse de la mesa aceptando una llamada privada también deja la sala a cero');
    raptor.close();

    // Estando en una línea PRIVADA no se entra a la de la mesa por sorpresa.
    const err = esperar(invitado, 'call_error');
    const amigo = await jugador(nuevoId('amigo'));
    const t2 = esperar(amigo, 'incoming_call');
    invitado.emit('call_friend', { targetPlayerId: amigo.cuenta });
    const e2 = await t2;
    amigo.emit('accept_call', { callId: e2.callId });
    await esperar(amigo, 'voice_pool_joined');
    invitado.emit('join_table_voice', {});
    const err2 = await err;
    comprobar(err2.code === 'ya_en_linea',
      'con una llamada privada en curso, entrar a la voz de la mesa pide decisión en vez de cortarla');

    anfitrion.close(); invitado.close(); deFuera.close(); amigo.close();
  }

  // ── 8. VERIFICACIÓN DE TOLERANCIA ────────────────────────────────────
  // El cliente ACTUAL, sin un solo cambio, contra este servidor. Se emiten
  // EXACTAMENTE los payloads que manda hoy useVoiceChat.js (con sus poolId,
  // callerName y playerId legados) y se leen los campos que hoy lee
  // (`data.members`). Si esto se rompe, el despliegue deja de poder hacerse por
  // partes.
  console.log('\n--- TOLERANCIA: el cliente actual, sin cambios, contra este servidor ---');
  {
    const viejo1 = await conectar();
    const id1 = nuevoId('viejo1');
    viejo1.emit('hello', { playerId: id1 });
    await esperar(viejo1, 'session');

    const viejo2 = await conectar();
    const id2 = nuevoId('viejo2');
    viejo2.emit('hello', { playerId: id2 });
    await esperar(viejo2, 'session');

    // El cliente actual NO emite voice_hello: no debe hacerle falta.
    const t = esperar(viejo2, 'incoming_call');
    viejo1.emit('call_friend', { targetPlayerId: id2, callerName: 'Viejo Uno', callerId: id1 });
    const entrante = await t;
    comprobar(!!entrante.callId, 'LLAMAR: el cliente antiguo hace sonar el teléfono igual que antes');

    const unido = esperar(viejo2, 'voice_pool_joined');
    const upd1 = esperar(viejo1, 'voice_pool_updated');
    viejo2.emit('accept_call', {
      callId: entrante.callId,
      poolId: entrante.poolId,     // hoy es undefined; el cliente lo manda igual
      playerId: id2,
      name: 'Viejo Dos'
    });
    const pool = await unido;
    const actualizado = await upd1;

    comprobar(Array.isArray(pool.members) && pool.members.length === 2,
      'ACEPTAR: `data.members` sigue existiendo, que es el campo que lee el cliente actual');
    comprobar(actualizado.poolId && actualizado.members.length === 2,
      'y el llamante recibe poolId + members por voice_pool_updated, como hoy');
    comprobar(actualizado.members.every(m => m.playerId && m.name),
      'los miembros conservan la forma { playerId, name }');

    const senal = esperar(viejo2, 'voice_pool_signal');
    viejo1.emit('voice_pool_signal', {
      poolId: actualizado.poolId,                 // campo legado: se ignora
      toPlayerId: id2,
      signal: { description: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' } }
    });
    const s = await senal;
    comprobar(s.fromPlayerId === id1, 'HABLAR: la señalización con poolId legado se entrega igual');

    const habla = esperar(viejo2, 'voice_pool_speaking');
    viejo1.emit('voice_pool_speaking', { poolId: actualizado.poolId, speaking: true });
    comprobar((await habla).playerId === id1, 'y el indicador de habla también');

    const fin = esperar(viejo2, 'voice_pool_updated');
    viejo1.emit('end_call', { poolId: actualizado.poolId, playerId: id1 });
    comprobar((await fin).members.length <= 1, 'COLGAR: end_call con poolId legado saca a quien cuelga');

    viejo1.close(); viejo2.close();
  }
}

(async () => {
  console.log('=== PRUEBAS DE VOZ (pools, consentimiento y reenganche) ===');
  await pruebasPuras();
  await pruebasDePolitica();

  await arrancarServidor();
  try {
    await pruebasDeIntegracion();
  } finally {
    server.kill();
    await pausa(300);
  }

  if (fallos) {
    console.error(`\n=== ${fallos} PRUEBA(S) DE VOZ FALLARON ===`);
    process.exit(1);
  }
  console.log('\n=== TODAS LAS PRUEBAS DE VOZ PASARON ===');
  process.exit(0);
})().catch((e) => {
  console.error('Error en las pruebas de voz:', e);
  if (server) server.kill();
  process.exit(1);
});
