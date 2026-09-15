// Señalización de la voz. NINGÚN manejador de este archivo conoce la sala: el
// transporte se direcciona a PERSONAS (ids de cuenta) y la pertenencia se
// deriva de `voicePools`, nunca del payload. Lo que sí se dirige a una sala
// —quién está en la voz de la mesa y quién habla— sale exclusivamente por
// `emitirAMesa`, que aliasa con guarda de asiento.
//
// ─── Reglas duras de este archivo ───
// 1. TODO manejador usa `await identity.ready(socket)`, jamás `currentId`:
//    `currentId` lee socket.data.playerId, que solo se escribe cuando resuelve
//    la promesa de `beginHandshake`, y el cliente emite `voice_hello` en el
//    MISMO tick que `hello`. Con la versión síncrona, el reenganche devolvería
//    null en TODAS las reconexiones y contestaría «sesión no verificada» — el
//    arreglo del fallo número uno en móvil no dispararía nunca, y en silencio.
//    La única excepción es `disconnect`, que debe ser SÍNCRONO: el manejador de
//    server.js corre justo detrás y desregistra la presencia.
// 2. UNA SOLA SESIÓN DE VOZ POR CUENTA. El timbre sí se reparte a todas las
//    pestañas (un teléfono suena en todas partes); la señalización va SOLO a la
//    pestaña ligada. Si se repartiera, una segunda pestaña ociosa levantaría
//    una RTCPeerConnection fantasma y contestaría, y con dos pestañas ofertando
//    contra la única `pc` que el remoto tiene indexada por cuenta, `polite`
//    sería idéntico en ambas y la negociación perfecta no podría resolver el
//    glare.
// 3. El pool NUNCA viene del payload. `accept_call` lo deriva del `callId`,
//    `voice_pool_signal` y `end_call` de la pertenencia del emisor. Eso mata
//    por construcción la inyección entre pools: no hay `if` que saltarse.

const { findMe, rooms } = require('../roomManager');
const identity = require('../identity');
const seatAliases = require('../seatAliases');
const presence = require('../presence');
const linea = require('../voicePools');
const politica = require('../voicePolicy');
const db = require('../db');
const {
  vozLlamarSchema,
  vozCallIdSchema,
  vozHablandoSchema,
  vozDispSchema,
  vozParEstadoSchema,
  vozSenalSchema,
  validate
} = require('../schemas');

// ─── Ayudantes de emisión ───

/** El timbre se reparte a TODAS las pestañas de una cuenta. */
function aCuenta(io, cuenta, evento, payload) {
  const set = presence.socketsOf(cuenta);
  if (!set || !set.size) return 0;
  for (const sid of set) io.to(sid).emit(evento, payload);
  return set.size;
}

/** Pestañas hermanas de una cuenta, excluyendo las indicadas. */
function hermanas(cuenta, ...excluir) {
  const set = presence.socketsOf(cuenta);
  if (!set) return [];
  return Array.from(set).filter(sid => !excluir.includes(sid));
}

/** La pestaña que tiene la voz de esta cuenta ahora mismo, si hay alguna. */
function sesionLigadaDe(cuenta) {
  const p = linea.poolDeCuenta(cuenta);
  const m = p && p.miembros.get(cuenta);
  return (m && m.sesionId) || null;
}

/**
 * ÚNICO camino de salida hacia una SALA. La guarda no es opcional:
 * `seatAliases.aliasDe` CREA el alias la primera vez, así que aliasar a alguien
 * que está en la llamada pero NO sentado en esa sala acuñaría un alias
 * forastero dentro de la tabla de la sala — el chip de la cinta no casaría
 * nunca y `cuentaDe` acabaría resolviendo a gente que no juega ahí.
 */
function emitirAMesa(io, roomId, evento, cuentas, extra = {}) {
  const game = rooms.get(roomId);
  if (!game) return;
  const alias = (cuentas || [])
    .filter(c => game.players.some(p => p.id === c))   // ← LA GUARDA
    .map(c => seatAliases.aliasDe(roomId, c));
  io.to(roomId).emit(evento, { roomId, alias, ...extra });
}

/**
 * Vista pública de un pool.
 *
 * `members` es un alias LEGADO de `miembros` y viaja a propósito durante la
 * ventana de tolerancia: el cliente actual lee `data.members` en
 * `onVoicePoolJoined`/`onVoicePoolUpdated`, así que renombrar el campo a secas
 * dejaría a todo el mundo sin llamada hasta que se desplegara el cliente nuevo.
 * Se retira cuando el cliente nuevo esté en producción.
 */
function poolPublico(p) {
  const miembros = linea.miembrosPublicos(p);
  return { poolId: p.poolId, contexto: p.contexto, miembros, members: miembros };
}

/** Anuncia a la SALA quién está en la voz de la mesa. */
function avisarMesa(io, p) {
  if (!p || p.contexto.tipo !== 'mesa' || !p.contexto.roomId) return;
  // `n` cuenta a TODOS los miembros (también a los amigos no sentados), para
  // que el chip pueda decir «3 en la voz» sin aliasar a nadie de fuera.
  emitirAMesa(io, p.contexto.roomId, 'table_voice', Array.from(p.miembros.keys()), { n: p.miembros.size });
}

function difundirPool(io, p) {
  if (!p) return;
  const payload = poolPublico(p);
  for (const { sesionId } of linea.sesionesDe(p)) io.to(sesionId).emit('voice_pool_updated', payload);
  avisarMesa(io, p);
}

/**
 * Cierre común de una salida de línea. `difundirPool` se llama SIEMPRE, también
 * cuando el pool queda vacío: si no, una mesa cuyo último participante se va
 * seguiría anunciando gente en la voz para toda la sala, sin nadie dentro.
 */
function trasSalir(io, salida) {
  if (!salida) return;
  difundirPool(io, salida.pool);
  if (!salida.vacio) limpiarSiHuerfano(io, salida.poolId);
}

/**
 * Un pool privado con un solo miembro y ningún timbre pendiente es basura: es
 * el que `call_friend` abrió con el llamante dentro y cuya llamada expiró o se
 * canceló. Antes sobrevivía con un miembro que nunca habló con nadie y la
 * siguiente llamada lo reutilizaba. Los pools de MESA no se limpian: uno solo
 * esperando a que se sumen los demás es un estado legítimo.
 */
function limpiarSiHuerfano(io, poolId) {
  const p = linea.pool(poolId);
  if (!p || p.contexto.tipo !== 'privado') return;
  if (p.miembros.size > 1) return;
  if (linea.hayLlamadasHaciaPool(poolId)) return;
  const sesiones = linea.borrarPool(poolId);
  for (const sid of sesiones) io.to(sid).emit('voice_pool_left', { poolId, motivo: 'linea_vacia' });
}

// ─── Nombres, actividad y política ───

function nombreDeCuenta(cuenta) {
  const conocido = presence.nombreDe(cuenta);
  if (conocido !== 'Jugador') return conocido;
  // Última oportunidad sin base de datos: si esa cuenta está sentada en alguna
  // sala, el motor ya sabe cómo se llama.
  const set = presence.socketsOf(cuenta);
  if (set) {
    for (const sid of set) {
      const ctx = findMe(sid);
      if (ctx && ctx.player && ctx.player.name) {
        presence.recordarNombre(cuenta, ctx.player.name);
        return presence.nombreDe(cuenta);
      }
    }
  }
  return conocido;
}

/**
 * Refresca la presencia que ven los amigos. Se llama en los pocos momentos en
 * que la actividad cambia de verdad (entrar y salir de una línea, y el «no
 * molestar»), no en cada evento de voz: cada llamada cuesta UNA consulta de
 * amigos, y la señalización es demasiado ruidosa para pagarla.
 * `aMisPestanas` incluye a las propias, para que la interfaz que acaba de
 * pulsar «no molestar» vea el cambio confirmado.
 */
function avisarPresencia(io, cuenta, aMisPestanas = false) {
  try {
    const amigos = require('../friendService');
    if (aMisPestanas) amigos.difundirPresencia(io, cuenta);
    else amigos.notifyFriendsOfPresence(io, cuenta);
  } catch (e) { /* la presencia es informativa: nunca debe tumbar una llamada */ }
}

/** Qué está haciendo esta pestaña, derivado en vivo de la sala. */
function actividadDeSocket(socketId, enLlamada) {
  const ctx = findMe(socketId);
  if (enLlamada) return { estado: 'en_llamada', roomId: ctx ? ctx.roomId : null };
  if (!ctx) return { estado: 'libre', roomId: null };
  return { estado: ctx.game.status === 'playing' ? 'jugando' : 'en_sala', roomId: ctx.roomId };
}

/** ¿Están estas dos cuentas sentadas en la misma sala? */
function mismaMesa(a, b) {
  for (const game of rooms.values()) {
    if (game.players.some(p => p.id === a) && game.players.some(p => p.id === b)) return true;
  }
  return false;
}

function dependenciasDePolitica() {
  return {
    hayPersistencia: () => typeof db.isEnabled === 'function' && db.isEnabled(),
    sonAmigos: (x, y) => db.sonAmigos(x, y),
    mismaMesa,
    estaEnLinea: (id) => presence.isOnline(id),
    disponibilidadDe: (id) => presence.disponibilidadDe(id)
  };
}

/** Cómo se anuncia una llamada según dónde nace. */
function tipoDeLlamada(p) {
  if (!p) return 'directa';
  if (p.contexto.tipo === 'mesa') return 'mesa';
  return p.miembros.size > 1 ? 'grupo' : 'directa';
}

function timbrandoPara(cuenta) {
  return linea.llamadasHacia(cuenta).map(l => ({
    callId: l.callId,
    fromPlayerId: l.deId,
    fromName: l.deNombre,
    tipo: l.tipo,
    expiraEn: l.expiraEn
  }));
}

function registerVoiceHandlers(io, socket) {
  const quienSoy = () => identity.ready(socket);

  // Estrangulador de `voice_peer_state`: 1/s por pareja. Es diagnóstico, no
  // control; a más ritmo solo gasta ancho de banda de los demás.
  const ultimoParEstado = new Map();

  // Al vencer el timbre: el llamante ve `call_timeout`, el destino deja de
  // sonar y el pool huérfano que abrió `call_friend` se borra con él.
  const alExpirarTimbre = (l) => {
    aCuenta(io, l.deId, 'call_timeout', { callId: l.callId });
    aCuenta(io, l.aId, 'call_cancelled', { callId: l.callId, motivo: 'timeout' });
    limpiarSiHuerfano(io, l.poolId);
  };

  // ─── 0. Reenganche: el cliente emite esto en CADA 'connect' ───
  socket.on('voice_hello', async () => {
    const cuenta = await quienSoy();
    if (!cuenta) return socket.emit('voice_state', { pool: null, enOtraPestana: false, timbrando: [] });

    const res = linea.reenganchar(cuenta, socket.id);

    if (res === 'otra_pestana') {
      // Que la pestaña nueva diga «estás en una llamada en otra pestaña» en vez
      // de un vacío sin explicación.
      return socket.emit('voice_state', { pool: null, enOtraPestana: true, timbrando: timbrandoPara(cuenta) });
    }

    if (res === 'ok') {
      const p = linea.poolDeCuenta(cuenta);
      presence.setActividad(socket.id, actividadDeSocket(socket.id, true));
      socket.emit('voice_state', { pool: poolPublico(p), enOtraPestana: false, timbrando: timbrandoPara(cuenta) });
      difundirPool(io, p);
      return;
    }

    socket.emit('voice_state', { pool: null, enOtraPestana: false, timbrando: timbrandoPara(cuenta) });
  });

  // ─── 1. Llamar a alguien ───
  socket.on('call_friend', async (data) => {
    const de = await quienSoy();
    if (!de) return socket.emit('call_error', { callId: null, code: 'no_verificado' });

    const v = validate(vozLlamarSchema, data);
    if (!v.success) return;
    const a = v.data.targetPlayerId;

    const permiso = await politica.puedeLlamar(de, a, dependenciasDePolitica());
    if (!permiso.ok) {
      // `a_ti_mismo` se descarta en silencio: no hay nada que contarle a nadie.
      if (permiso.code === 'a_ti_mismo') return;
      return socket.emit('call_error', { callId: null, code: permiso.code });
    }

    // El nombre lo pone el SERVIDOR. Antes viajaba en el payload sin validar
    // hasta un <h4> del cliente: cualquiera podía timbrar con el nombre de otro.
    const deNombre = nombreVisible(socket, de);

    let p = linea.poolDeCuenta(de);
    if (p) {
      if (p.miembros.has(a)) return;                       // ya está dentro
      if (p.miembros.size >= linea.TOPE_MIEMBROS) {
        return socket.emit('call_error', { callId: null, code: 'linea_llena' });
      }
    } else {
      p = linea.crearPool({ tipo: 'privado', roomId: null });
    }
    // Ligar (o religar) mi pestaña: el llamante entra en la línea antes de que
    // suene nada, y por eso el temporizador debe borrar el pool si nadie coge.
    if (!linea.entrar(p.poolId, { cuentaId: de, name: deNombre, sesionId: socket.id })) {
      return socket.emit('call_error', { callId: null, code: 'linea_llena' });
    }

    const tipo = tipoDeLlamada(p);
    const l = linea.registrarLlamada({ poolId: p.poolId, deId: de, deNombre, aId: a, tipo }, alExpirarTimbre);
    politica.registrarTimbre(de, a);
    politica.podar();

    // El timbre a TODAS sus pestañas; la señalización, solo a la ligada.
    // `poolId` NO viaja aquí: quien recibe el timbre no necesita conocerlo
    // hasta aceptar.
    aCuenta(io, a, 'incoming_call', {
      callId: l.callId,
      fromPlayerId: de,
      fromName: deNombre,
      tipo,
      expiraEn: l.expiraEn
    });

    socket.emit('call_outgoing', {
      callId: l.callId,
      targetPlayerId: a,
      targetName: nombreDeCuenta(a),
      expiraEn: l.expiraEn
    });
    presence.setActividad(socket.id, actividadDeSocket(socket.id, true));
  });

  // ─── 2. Sumar a un tercero a la línea en curso ───
  socket.on('invite_to_pool', async (data) => {
    const de = await quienSoy();
    if (!de) return socket.emit('call_error', { callId: null, code: 'no_verificado' });

    const v = validate(vozLlamarSchema, data);
    if (!v.success) return;
    const a = v.data.targetPlayerId;

    // PERTENENCIA: antes no se comprobaba, así que cualquiera podía invitar a
    // un pool ajeno con solo conocer su id.
    const p = linea.poolDeCuenta(de);
    if (!p) return;                                        // 'no_miembro' → silencio
    const mio = p.miembros.get(de);
    if (!mio || mio.sesionId !== socket.id) return;        // pestaña no ligada
    if (p.miembros.has(a)) return;
    if (p.miembros.size >= linea.TOPE_MIEMBROS) {
      return socket.emit('call_error', { callId: null, code: 'linea_llena' });
    }

    const permiso = await politica.puedeLlamar(de, a, dependenciasDePolitica());
    if (!permiso.ok) {
      if (permiso.code === 'a_ti_mismo') return;
      return socket.emit('call_error', { callId: null, code: permiso.code });
    }

    const deNombre = nombreVisible(socket, de);
    const tipo = tipoDeLlamada(p);
    const l = linea.registrarLlamada({ poolId: p.poolId, deId: de, deNombre, aId: a, tipo }, alExpirarTimbre);
    politica.registrarTimbre(de, a);

    aCuenta(io, a, 'incoming_call', {
      callId: l.callId,
      fromPlayerId: de,
      fromName: deNombre,
      tipo,
      expiraEn: l.expiraEn
    });
    socket.emit('call_outgoing', {
      callId: l.callId,
      targetPlayerId: a,
      targetName: nombreDeCuenta(a),
      expiraEn: l.expiraEn
    });
  });

  // ─── 3. Aceptar ───
  socket.on('accept_call', async (data) => {
    const cuenta = await quienSoy();
    if (!cuenta) return socket.emit('call_error', { callId: null, code: 'no_verificado' });

    const v = validate(vozCallIdSchema, data);
    if (!v.success) return;

    // El pool se deriva SIEMPRE de la llamada. Antes ganaba el `poolId` del
    // payload y, si el pool no existía, se creaba: bastaba con inventarse un id
    // —o reutilizar el que venía en un `incoming_call` antiguo— para meterse a
    // escuchar en una línea ajena.
    const l = linea.llamada(v.data.callId);
    if (!l) return socket.emit('call_error', { callId: v.data.callId, code: 'no_existe' });
    if (l.aId !== cuenta) return;                          // 'no_miembro' → silencio

    linea.olvidarLlamada(l.callId);

    const p = linea.pool(l.poolId);
    // `accept_call` NUNCA crea pools. Si el del llamante ya no existe, la
    // llamada murió con él.
    if (!p) return socket.emit('call_error', { callId: l.callId, code: 'no_existe' });

    const nombre = nombreVisible(socket, cuenta);
    const res = linea.entrar(p.poolId, { cuentaId: cuenta, name: nombre, sesionId: socket.id });
    if (!res) return socket.emit('call_error', { callId: l.callId, code: 'linea_llena' });

    // Toma de relevo: la pestaña que tenía la voz se desmonta…
    if (res.relevado) io.to(res.relevado).emit('voice_taken', { callId: l.callId });
    // …y las hermanas que estaban timbrando dejan de sonar con motivo.
    for (const sid of hermanas(cuenta, socket.id, res.relevado)) {
      io.to(sid).emit('call_cancelled', { callId: l.callId, motivo: 'atendida_en_otra_pestana' });
    }
    trasSalir(io, res.salioDe);

    aCuenta(io, l.deId, 'call_accepted', { callId: l.callId });
    socket.emit('voice_pool_joined', poolPublico(p));
    difundirPool(io, p);
    presence.setActividad(socket.id, actividadDeSocket(socket.id, true));
    avisarPresencia(io, cuenta);
  });

  // ─── 4. Rechazar ───
  socket.on('decline_call', async (data) => {
    const cuenta = await quienSoy();
    if (!cuenta) return;

    const v = validate(vozCallIdSchema, data);
    if (!v.success) return;
    const l = linea.llamada(v.data.callId);
    if (!l || l.aId !== cuenta) return;

    linea.olvidarLlamada(l.callId);
    politica.registrarRechazo(l.deId, l.aId);

    aCuenta(io, l.deId, 'call_declined', { callId: l.callId });
    // Las hermanas dejan de sonar EN SILENCIO: no se ha contestado, se ha
    // rechazado, y no hay nada que contarle a esas pestañas.
    //
    // Se EXCLUYE la pestaña que tenga la voz: `voice_taken` significa «te han
    // quitado la línea», así que una pestaña que esté en una llamada colgaría.
    // Con llamada en espera —estoy hablando en una pestaña y me entra otra
    // llamada que rechazo desde la otra— eso cortaría la conversación en curso.
    for (const sid of hermanas(cuenta, socket.id, sesionLigadaDe(cuenta))) {
      io.to(sid).emit('voice_taken', { callId: l.callId });
    }
    limpiarSiHuerfano(io, l.poolId);
  });

  // ─── 5. Cancelar lo que estoy haciendo sonar ───
  socket.on('call_cancel', async (data) => {
    const cuenta = await quienSoy();
    if (!cuenta) return;

    const v = validate(vozCallIdSchema, data);
    if (!v.success) return;
    const l = linea.llamada(v.data.callId);
    if (!l || l.deId !== cuenta) return;

    linea.olvidarLlamada(l.callId);
    aCuenta(io, l.aId, 'call_cancelled', { callId: l.callId, motivo: 'colgo' });
    limpiarSiHuerfano(io, l.poolId);
  });

  // ─── 6. Colgar ───
  socket.on('end_call', async () => {
    const cuenta = await quienSoy();
    if (!cuenta) return;

    // Colgar durante el timbrado también apaga lo que esté sonando: si no, el
    // teléfono del otro seguiría sonando 30 s por alguien que ya se fue.
    for (const l of linea.llamadasDe(cuenta)) {
      linea.olvidarLlamada(l.callId);
      aCuenta(io, l.aId, 'call_cancelled', { callId: l.callId, motivo: 'colgo' });
    }

    const salida = linea.salir(cuenta);
    presence.setActividad(socket.id, actividadDeSocket(socket.id, false));
    avisarPresencia(io, cuenta);
    if (!salida) return;

    socket.emit('voice_pool_left', { poolId: salida.poolId, motivo: 'colgado_por_mi' });
    trasSalir(io, salida);
  });

  // ─── 7. Señalización WebRTC ───
  socket.on('voice_pool_signal', async (data) => {
    const de = await quienSoy();
    if (!de) return;

    const v = validate(vozSenalSchema, data);
    if (!v.success) return;

    // El pool se DERIVA de la pertenencia del emisor. Antes se buscaba con el
    // `poolId` del payload: derivarlo mata la inyección entre pools por
    // construcción, no con un `if`.
    const p = linea.poolDeCuenta(de);
    if (!p) return;
    const mio = p.miembros.get(de);
    if (!mio || mio.sesionId !== socket.id) return;       // una pestaña no ligada no señaliza

    const hacia = v.data.toPlayerId;
    if (hacia === de) return;                             // 'a_ti_mismo' → silencio
    const destino = p.miembros.get(hacia);
    if (!destino || !destino.sesionId) return;            // no se señaliza fuera del propio pool

    io.to(destino.sesionId).emit('voice_pool_signal', { fromPlayerId: de, signal: v.data.signal });
  });

  // ─── 8. Quién habla ───
  socket.on('voice_pool_speaking', async (data) => {
    const cuenta = await quienSoy();
    if (!cuenta) return;

    const v = validate(vozHablandoSchema, data);
    if (!v.success) return;

    const p = linea.poolDeCuenta(cuenta);
    if (!p) return;
    const mio = p.miembros.get(cuenta);
    if (!mio || mio.sesionId !== socket.id) return;

    // Dentro de la línea se habla en ids de CUENTA…
    for (const { sesionId } of linea.sesionesDe(p, cuenta)) {
      io.to(sesionId).emit('voice_pool_speaking', { playerId: cuenta, speaking: v.data.speaking });
    }
    // …y hacia la sala, en ALIAS. Son dos diccionarios distintos a propósito:
    // antes ambos caían en el mismo índice del cliente y se pisaban.
    if (p.contexto.tipo === 'mesa' && p.contexto.roomId) {
      emitirAMesa(io, p.contexto.roomId, 'table_speaking', [cuenta], { speaking: v.data.speaking });
    }
  });

  // ─── 9. Diagnóstico bilateral: cómo veo yo a cada par ───
  socket.on('voice_peer_state', async (data) => {
    const cuenta = await quienSoy();
    if (!cuenta) return;

    const v = validate(vozParEstadoSchema, data);
    if (!v.success) return;

    const p = linea.poolDeCuenta(cuenta);
    if (!p) return;
    const mio = p.miembros.get(cuenta);
    if (!mio || mio.sesionId !== socket.id) return;
    if (!p.miembros.has(v.data.peerPlayerId)) return;

    const clave = `${cuenta}>${v.data.peerPlayerId}`;
    const ahora = Date.now();
    if (ahora - (ultimoParEstado.get(clave) || 0) < 1000) return;
    ultimoParEstado.set(clave, ahora);

    const payload = { playerId: cuenta, peerPlayerId: v.data.peerPlayerId, estado: v.data.estado };
    for (const { sesionId } of linea.sesionesDe(p, cuenta)) io.to(sesionId).emit('voice_peer_state', payload);
  });

  // ─── 10. Entrar a la voz de la mesa ───
  socket.on('join_table_voice', async () => {
    const cuenta = await quienSoy();
    if (!cuenta) return socket.emit('call_error', { callId: null, code: 'no_verificado' });

    const ctx = findMe(socket.id);
    if (!ctx) return socket.emit('call_error', { callId: null, code: 'no_existe' });

    const poolId = `tvoice_${ctx.roomId}`;
    const actual = linea.poolDeCuenta(cuenta);
    if (actual && actual.poolId !== poolId && actual.contexto.tipo === 'privado') {
      // No se corta la llamada por sorpresa: el cliente ofrece «Traer a la
      // mesa» / «Cambiar» como botones persistentes.
      return socket.emit('call_error', { callId: null, code: 'ya_en_linea' });
    }

    presence.recordarNombre(cuenta, ctx.player.name);
    const p = linea.crearPool({ tipo: 'mesa', roomId: ctx.roomId }, poolId);
    const res = linea.entrar(poolId, { cuentaId: cuenta, name: ctx.player.name, sesionId: socket.id });
    if (!res) return socket.emit('call_error', { callId: null, code: 'linea_llena' });

    if (res.relevado) io.to(res.relevado).emit('voice_taken', { callId: null });
    trasSalir(io, res.salioDe);

    // NO SE TIMBRA A NADIE, y es deliberado: en una sala pública los demás son
    // desconocidos, y hacer sonar tres teléfonos por pulsar un botón de la
    // barra del juego sería molestar sin consentimiento. Si algún día se quiere
    // el timbre en la mesa, va detrás de un ajuste por usuario — y ese ajuste
    // necesita persistencia, que es justo lo que no hay por defecto.
    socket.emit('voice_pool_joined', poolPublico(p));
    difundirPool(io, p);
    presence.setActividad(socket.id, actividadDeSocket(socket.id, true));
    avisarPresencia(io, cuenta);
  });

  // ─── 11. No molestar ───
  socket.on('set_availability', async (data) => {
    const cuenta = await quienSoy();
    if (!cuenta) return;

    const v = validate(vozDispSchema, data);
    if (!v.success) return;

    presence.setDisponibilidad(cuenta, v.data.modo);
    avisarPresencia(io, cuenta, true);
  });

  // ─── Desconexión ───
  // SÍNCRONO a propósito: el manejador de server.js corre justo detrás y hace
  // `presence.unregister`, así que aquí todavía se sabe de quién era el socket.
  socket.on('disconnect', () => {
    const cuenta = identity.currentId(socket) || presence.playerOf(socket.id);

    if (cuenta) {
      const set = presence.socketsOf(cuenta);
      const eraLaUltima = !set || set.size <= 1;

      if (eraLaUltima) {
        // Timbres que YO estaba haciendo sonar: se apagan.
        for (const l of linea.llamadasDe(cuenta)) {
          linea.olvidarLlamada(l.callId);
          aCuenta(io, l.aId, 'call_cancelled', { callId: l.callId, motivo: 'colgo' });
          limpiarSiHuerfano(io, l.poolId);
        }
        // Timbres dirigidos a MÍ: el llamante se entera de que me he ido en vez
        // de quedarse con la tarjeta «Llamando…» hasta el final del timbre.
        for (const l of linea.llamadasHacia(cuenta)) {
          linea.olvidarLlamada(l.callId);
          aCuenta(io, l.deId, 'call_error', { callId: l.callId, code: 'desconectado' });
          limpiarSiHuerfano(io, l.poolId);
        }
      }
    }

    // La pertenencia NO se borra: queda ausente con su margen de gracia. Los
    // RTCPeerConnection del cliente tampoco se cierran, así que si vuelve antes
    // de que expire, el audio no se habrá cortado.
    const marca = linea.marcarAusente(socket.id, (_c, p) => {
      difundirPool(io, p);
      limpiarSiHuerfano(io, p.poolId);
    });
    if (marca) difundirPool(io, marca.pool);
  });
}

/** Registra el nombre que el motor conoce para esta cuenta y lo devuelve. */
function nombreVisible(socket, cuenta) {
  const ctx = findMe(socket.id);
  if (ctx && ctx.player && ctx.player.name) presence.recordarNombre(cuenta, ctx.player.name);
  return presence.nombreDe(cuenta);
}

/**
 * Levantarse de la mesa saca de la voz DE ESA MESA (y solo de esa): una llamada
 * privada no se corta por cambiar de pantalla. Lo llama `leave_room`; vive aquí
 * para que la difusión —y la guarda de asiento de `emitirAMesa`— sigan estando
 * en un único sitio.
 */
function abandonarVozDeMesa(io, cuenta, roomId) {
  const p = linea.poolDeCuenta(cuenta);
  if (!p || p.contexto.tipo !== 'mesa' || p.contexto.roomId !== roomId) return false;
  const salida = linea.salir(cuenta);
  if (!salida) return false;
  trasSalir(io, salida);
  avisarPresencia(io, cuenta);
  return true;
}

module.exports = { registerVoiceHandlers, emitirAMesa, abandonarVozDeMesa };
