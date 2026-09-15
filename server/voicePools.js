// Pools de voz («líneas»): quién habla con quién, indexado por CUENTA.
//
// ─── Por qué la pertenencia es de la cuenta y no del socket ───
// El almacén anterior guardaba el `socketId` de cada miembro y el `disconnect`
// lo borraba del pool. En móvil el socket se reconecta constantemente (el
// cliente configura reconnectionAttempts: Infinity a propósito), así que una
// llamada moría cada vez que el teléfono cambiaba de red: las
// RTCPeerConnection quedaban huérfanas, el cliente seguía pintando «conectado»
// y ningún camino volvía a montar la llamada. Era el fallo número uno en móvil
// y no daba ni un error.
//
// Aquí la pertenencia es de la CUENTA y el socket es solo la pestaña LIGADA.
// Al desconectar, el miembro queda `ausente` durante GRACIA_MS y su sitio se
// guarda; si vuelve a tiempo (`voice_hello`) se reengancha. Como una
// RTCPeerConnection no muere porque muera el socket de señalización, si el
// reenganche llega dentro del margen el audio no se ha cortado nunca.
//
// Este módulo es LÓGICA PURA: no conoce `io`, no emite nada y no requiere
// ningún otro módulo del servidor. Los temporizadores reciben su callback desde
// fuera para poder probarlos sin levantar un servidor.

const crypto = require('crypto');

// Margen de reenganche. NO es un número medido: retener N mapas y N
// temporizadores durante una tormenta de reconexiones es memoria que hoy no se
// gasta, en un servidor de 512 MB. Por eso vive en UNA constante exportada y
// viene con contadores expuestos en /health: si `graciasExpiradas` domina,
// se baja; si los reenganches llegan tarde, se sube. El cliente tiene su propio
// tope (RECUPERANDO_TOPE) ESTRICTAMENTE menor que este.
// `VOZ_GRACIA_MS` permite ajustarlo sin tocar código (y es lo que usa la suite
// para no esperar medio minuto). Ojo al bajarlo en producción: el cliente
// abandona a los 25 s (RECUPERANDO_TOPE), así que por debajo de eso el
// reenganche deja de existir y toda reconexión móvil pierde la llamada.
const GRACIA_MS = Math.max(200, Number(process.env.VOZ_GRACIA_MS) || 30000);

// Tope duro de participantes por línea. La malla es completa: con 6 son 15
// conexiones y 30 flujos, que ya es mucho para un móvil de gama baja.
const TOPE_MIEMBROS = 6;

// Ventana de timbrado del servidor. El tope del cliente es mayor a propósito.
const TIMBRE_MS = 30000;

// poolId -> { poolId, contexto:{tipo,roomId}, miembros: Map<cuentaId, miembro> }
// miembro: { cuentaId, name, sesionId, ausenteDesde, temporizador }
const pools = new Map();

// Índice inverso: UN pool por cuenta. Es lo que permite derivar la pertenencia
// del emisor en vez de fiarse del `poolId` que mande el cliente.
const poolDe = new Map();

// callId -> { callId, poolId, deId, deNombre, aId, tipo, expiraEn, temporizador }
const llamadas = new Map();

// Instrumentación del margen de gracia (se expone en /health).
const contadores = { reenganchesOk: 0, graciasExpiradas: 0 };

function nuevoId(prefijo) {
  return `${prefijo}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

/** Crea un pool vacío. `idFijo` lo usa la voz de mesa ('tvoice_<sala>'). */
function crearPool(contexto, idFijo) {
  const poolId = idFijo || nuevoId('vpool');
  const existente = pools.get(poolId);
  if (existente) return existente;
  const pool = {
    poolId,
    contexto: { tipo: contexto?.tipo === 'mesa' ? 'mesa' : 'privado', roomId: contexto?.roomId || null },
    miembros: new Map()
  };
  pools.set(poolId, pool);
  return pool;
}

function pool(poolId) {
  return pools.get(poolId) || null;
}

function poolDeCuenta(cuenta) {
  const poolId = poolDe.get(cuenta);
  return poolId ? (pools.get(poolId) || null) : null;
}

function estaEnLinea(cuenta) {
  return poolDe.has(cuenta);
}

/** Vista que viaja al cliente. Nunca sale el socketId de nadie. */
function miembrosPublicos(p) {
  if (!p) return [];
  return Array.from(p.miembros.values()).map(m => ({
    playerId: m.cuentaId,
    name: m.name,
    estado: m.sesionId ? 'presente' : 'ausente'
  }));
}

/** Sesiones ligadas del pool (las ausentes no tienen). */
function sesionesDe(p, exceptoCuenta) {
  const salida = [];
  if (!p) return salida;
  for (const m of p.miembros.values()) {
    if (m.cuentaId === exceptoCuenta) continue;
    if (m.sesionId) salida.push({ cuentaId: m.cuentaId, sesionId: m.sesionId });
  }
  return salida;
}

function cancelarGracia(miembro) {
  if (miembro && miembro.temporizador) {
    clearTimeout(miembro.temporizador);
    miembro.temporizador = null;
  }
  if (miembro) miembro.ausenteDesde = null;
}

/**
 * Liga una cuenta a un pool con la pestaña `sesionId`.
 * Devuelve { pool, relevado, salioDe } donde:
 *   · relevado = socketId de la pestaña anterior de ESA MISMA cuenta (si había
 *     otra viva). Es la «toma de relevo»: una sola sesión de voz por cuenta.
 *   · salioDe  = pool del que se la sacó (no se puede estar en dos líneas).
 * Devuelve null si el pool no existe o está lleno.
 */
function entrar(poolId, { cuentaId, name, sesionId }) {
  const p = pools.get(poolId);
  if (!p || !cuentaId) return null;

  const yaEstaba = p.miembros.get(cuentaId);
  if (!yaEstaba && p.miembros.size >= TOPE_MIEMBROS) return null;

  // La pestaña que HOY tiene la voz de esta cuenta, esté en la línea que esté:
  // el relevo se toma también al saltar de una línea a otra, no solo al volver
  // a entrar en la misma. Si no, la pestaña vieja se quedaría con su mitad de
  // la señalización viva y nadie le habría dicho que se desmonte.
  let relevado = null;
  const anterior = poolDe.get(cuentaId);
  if (anterior) {
    const pAnterior = pools.get(anterior);
    const mAnterior = pAnterior && pAnterior.miembros.get(cuentaId);
    if (mAnterior && mAnterior.sesionId && mAnterior.sesionId !== sesionId) relevado = mAnterior.sesionId;
  }

  // Una cuenta no puede estar en dos líneas: se la saca de la anterior.
  let salioDe = null;
  if (anterior && anterior !== poolId) salioDe = salir(cuentaId);

  if (yaEstaba) {
    cancelarGracia(yaEstaba);
    yaEstaba.sesionId = sesionId;
    if (name) yaEstaba.name = name;
  } else {
    p.miembros.set(cuentaId, {
      cuentaId,
      name: name || 'Jugador',
      sesionId,
      ausenteDesde: null,
      temporizador: null
    });
  }
  poolDe.set(cuentaId, poolId);
  return { pool: p, relevado, salioDe };
}

/**
 * Saca a una cuenta de su pool. Devuelve { poolId, pool, vacio } o null.
 * El pool vacío se borra aquí: nadie tiene que acordarse de hacerlo.
 */
function salir(cuenta) {
  const poolId = poolDe.get(cuenta);
  if (!poolId) return null;
  poolDe.delete(cuenta);
  const p = pools.get(poolId);
  if (!p) return { poolId, pool: null, vacio: true };
  cancelarGracia(p.miembros.get(cuenta));
  p.miembros.delete(cuenta);
  const vacio = p.miembros.size === 0;
  if (vacio) pools.delete(poolId);
  return { poolId, pool: p, vacio };
}

/**
 * La pestaña ligada se ha ido: el miembro NO se borra, queda `ausente` con un
 * temporizador de GRACIA_MS. `alExpirar(cuenta, pool)` corre al vencer, y
 * recibe el pool para que quien avisa a la sala sepa a cuál (al vencer, el
 * miembro ya no está dentro y el pool puede haberse quedado vacío).
 * Devuelve { cuenta, pool }, o null si ese socket no estaba ligado a nada.
 */
function marcarAusente(sesionId, alExpirar) {
  for (const p of pools.values()) {
    for (const m of p.miembros.values()) {
      if (m.sesionId !== sesionId) continue;
      m.sesionId = null;
      m.ausenteDesde = Date.now();
      cancelarGraciaSolo(m);
      m.temporizador = setTimeout(() => {
        m.temporizador = null;
        contadores.graciasExpiradas++;
        salir(m.cuentaId);
        if (typeof alExpirar === 'function') alExpirar(m.cuentaId, p);
      }, GRACIA_MS);
      // No bloquear el cierre del proceso por un margen de gracia pendiente.
      if (typeof m.temporizador.unref === 'function') m.temporizador.unref();
      return { cuenta: m.cuentaId, pool: p };
    }
  }
  return null;
}

// Igual que cancelarGracia pero sin tocar `ausenteDesde` (lo acabamos de fijar).
function cancelarGraciaSolo(miembro) {
  if (miembro && miembro.temporizador) {
    clearTimeout(miembro.temporizador);
    miembro.temporizador = null;
  }
}

/**
 * Reenganche tras reconectar. Devuelve:
 *   'ok'           → la pertenencia estaba ausente y se ha ligado a `sesionId`
 *   'otra_pestana' → hay otra pestaña VIVA ligada a esa cuenta
 *   'sin_pool'     → la cuenta no está en ninguna línea
 */
function reenganchar(cuenta, sesionId) {
  const p = poolDeCuenta(cuenta);
  if (!p) return 'sin_pool';
  const m = p.miembros.get(cuenta);
  if (!m) return 'sin_pool';
  if (m.sesionId && m.sesionId !== sesionId) return 'otra_pestana';
  const estabaAusente = !m.sesionId;
  cancelarGracia(m);
  m.sesionId = sesionId;
  if (estabaAusente) contadores.reenganchesOk++;
  return 'ok';
}

// ─── Llamadas timbrando ───

function registrarLlamada({ poolId, deId, deNombre, aId, tipo }, alExpirar) {
  const callId = nuevoId('call');
  const expiraEn = Date.now() + TIMBRE_MS;
  const llamada = { callId, poolId, deId, deNombre, aId, tipo, expiraEn, temporizador: null };
  // El temporizador se GUARDA para poder cancelarlo. Antes se creaba suelto y
  // no se limpiaba en accept/decline/disconnect: la llamada seguía «viva» en
  // un setTimeout capturado que disparaba 30 s después sobre nada.
  llamada.temporizador = setTimeout(() => {
    llamada.temporizador = null;
    llamadas.delete(callId);
    if (typeof alExpirar === 'function') alExpirar(llamada);
  }, TIMBRE_MS);
  if (typeof llamada.temporizador.unref === 'function') llamada.temporizador.unref();
  llamadas.set(callId, llamada);
  return llamada;
}

function llamada(callId) {
  return llamadas.get(callId) || null;
}

function olvidarLlamada(callId) {
  const l = llamadas.get(callId);
  if (!l) return null;
  if (l.temporizador) clearTimeout(l.temporizador);
  llamadas.delete(callId);
  return l;
}

/** Llamadas que están timbrando EN el teléfono de `cuenta`. */
function llamadasHacia(cuenta) {
  return Array.from(llamadas.values()).filter(l => l.aId === cuenta);
}

/** Llamadas que ha iniciado `cuenta` y siguen timbrando. */
function llamadasDe(cuenta) {
  return Array.from(llamadas.values()).filter(l => l.deId === cuenta);
}

/** ¿Queda alguna llamada apuntando a este pool? (para no borrarlo a medias) */
function hayLlamadasHaciaPool(poolId) {
  for (const l of llamadas.values()) if (l.poolId === poolId) return true;
  return false;
}

/** Borra un pool entero y sus índices. Devuelve las sesiones que había dentro. */
function borrarPool(poolId) {
  const p = pools.get(poolId);
  if (!p) return [];
  const sesiones = [];
  for (const m of p.miembros.values()) {
    cancelarGracia(m);
    poolDe.delete(m.cuentaId);
    if (m.sesionId) sesiones.push(m.sesionId);
  }
  pools.delete(poolId);
  return sesiones;
}

/** Foto para /health: el margen de gracia no se ajusta de oído. */
function instantanea() {
  let ausentes = 0;
  let enLinea = 0;
  for (const p of pools.values()) {
    for (const m of p.miembros.values()) {
      enLinea++;
      if (!m.sesionId) ausentes++;
    }
  }
  return {
    lineas: pools.size,
    enLinea,
    ausentes,
    timbrando: llamadas.size,
    graciaMs: GRACIA_MS,
    reenganchesOk: contadores.reenganchesOk,
    graciasExpiradas: contadores.graciasExpiradas
  };
}

/** Solo para pruebas: deja el módulo como recién cargado. */
function _reset() {
  for (const p of pools.values()) for (const m of p.miembros.values()) cancelarGracia(m);
  for (const l of llamadas.values()) if (l.temporizador) clearTimeout(l.temporizador);
  pools.clear();
  poolDe.clear();
  llamadas.clear();
  contadores.reenganchesOk = 0;
  contadores.graciasExpiradas = 0;
}

module.exports = {
  GRACIA_MS,
  TOPE_MIEMBROS,
  TIMBRE_MS,
  crearPool,
  pool,
  poolDeCuenta,
  estaEnLinea,
  miembrosPublicos,
  sesionesDe,
  entrar,
  salir,
  marcarAusente,
  reenganchar,
  registrarLlamada,
  llamada,
  olvidarLlamada,
  llamadasHacia,
  llamadasDe,
  hayLlamadasHaciaPool,
  borrarPool,
  instantanea,
  _reset
};
