// Identidad de jugador vinculada al socket.
//
// ─── Qué falló antes (auditoría 2026-07-27, C-2) ───
// El handshake emitía un token para CUALQUIER playerId que le pidieran:
//
//     const authed = verify(playerId, token);            // false, no traigo token
//     const outToken = authed ? token : issueToken(playerId);   // ← lo regalaba
//
// Como además el `playerId` real de cuenta viaja en `game_state` a rivales y
// espectadores, bastaba con mirar una partida, pedir el token de otro y
// reconectar con él para quedar autenticado como esa persona. El token era
// `HMAC(playerId)` puro: sin caducidad, sin nonce y sin forma de revocarlo, o
// sea una contraseña permanente derivable a petición. `AUTH_STRICT=1` no
// protegía de nada porque el atacante llegaba con authed=true.
//
// ─── Cómo funciona ahora ───
// 1. RECLAMACIÓN (confianza en el primer uso). Cada identidad guarda un secreto
//    propio (`users.auth_nonce`). La primera conexión que presenta un id libre
//    lo reclama y recibe su token. A partir de ahí el servidor NO vuelve a
//    emitir token para ese id: hay que presentar uno válido. Se acabó el oráculo.
// 2. VINCULACIÓN SOLO CON PRUEBA. Antes se vinculaba el socket a la identidad
//    aunque no estuviera autenticado, y la capa social usaba esa vinculación.
//    Ahora, si no puedes demostrar que es tuya, el socket NO queda vinculado y
//    las operaciones sociales/económicas simplemente no encuentran identidad.
// 3. TOKEN v2: versionado, con caducidad y firmado sobre el nonce de la cuenta,
//    así que se puede revocar (basta con cambiar el nonce en la BD).
// 4. FALLO CERRADO. Si hay BD pero la consulta falla, se deniega. Nunca se
//    concede una identidad porque la base de datos esté caída.
//
// Límite conocido y asumido: sin registro (ni email ni contraseña) esto es
// confianza-en-el-primer-uso. Quien reclame un id ANTES que su dueño se queda
// con él, y hay una ventana de migración al desplegar en la que las cuentas
// existentes están sin reclamar. Cerrarlo del todo exige autenticación real
// (OAuth/email), que es una decisión de producto, no un parche.

const crypto = require('crypto');

// Secreto para firmar. En producción, definir AUTH_SECRET (persistente entre
// reinicios). Si falta, se genera uno efímero por arranque.
let SECRET = process.env.AUTH_SECRET || '';

// Con persistencia, AUTH_SECRET pasa a ser OBLIGATORIO y se comprueba al
// arrancar. Motivo: las reclamaciones viven en la BD y sobreviven al reinicio,
// pero los tokens se firman con este secreto. Si fuera efímero, tras cada
// reinicio ningún token verificaría, todos los ids seguirían reclamados y cada
// jugador sería rechazado y empezaría una identidad nueva: pérdida SILENCIosa e
// irreversible de monedas, skins, ELO y amigos de todo el mundo, en cada
// reinicio (y en Render los hay de sobra). Es preferible no arrancar: el fallo
// se ve al instante y se arregla con una variable de entorno.
if (!SECRET && process.env.DATABASE_URL) {
  console.error(
    '[identidad] FALTA AUTH_SECRET y hay DATABASE_URL configurada.\n' +
    '  Con un secreto efímero, cada reinicio invalidaría todas las sesiones y,\n' +
    '  como las identidades quedan reclamadas en la BD, TODOS los jugadores\n' +
    '  perderían su cuenta (monedas, skins, ELO, amigos) sin previo aviso.\n' +
    '  Genera uno estable y ponlo en el entorno:\n' +
    '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
  process.exit(1);
}

if (!SECRET) {
  // Sin BD no hay nada que perder: el registro de reclamaciones también vive en
  // memoria, así que tras un reinicio todo vuelve a empezar de forma coherente.
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[identidad] AUTH_SECRET no definido: usando secreto EFÍMERO (modo sin persistencia).');
}

// Exigir token válido en operaciones económicas. Con el oráculo cerrado, la
// vinculación ya solo ocurre tras demostrar la propiedad, así que el modo
// estricto es hoy una red adicional más que la única barrera.
const STRICT = /^(1|true|yes)$/i.test(process.env.AUTH_STRICT || '');

const VERSION = 'v2';
// 180 días. El token se renueva en cada conexión, así que un jugador activo no
// lo ve caducar nunca; solo expira tras medio año sin jugar.
const TOKEN_TTL_MS = 180 * 24 * 3600 * 1000;

function newNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function sign(playerId, exp, nonce) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${VERSION}|${playerId}|${exp}|${nonce}`)
    .digest('hex');
}

// Token: "v2.<caducidad>.<firma>". El playerId no viaja dentro porque siempre
// se presenta al lado, y va incluido en la firma.
function issueToken(playerId, nonce, now = Date.now()) {
  if (!playerId || !nonce) return null;
  const exp = now + TOKEN_TTL_MS;
  return `${VERSION}.${exp}.${sign(playerId, exp, nonce)}`;
}

function verifyToken(playerId, token, nonce, now = Date.now()) {
  if (!playerId || !token || !nonce) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return false;

  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= now) return false;

  // Comparación en tiempo constante (evita fugas por temporización).
  const expected = Buffer.from(sign(playerId, exp, nonce));
  const given = Buffer.from(parts[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// ─── Registro de reclamaciones ───
// La BD es la fuente de verdad; este Map es caché y, sin BD, el registro entero.
const memClaims = new Map(); // playerId -> nonce

// Devuelve { nonce, isNew } o { failed: true } si hay BD y no se pudo consultar.
async function claimIdentity(playerId) {
  const cached = memClaims.get(playerId);
  if (cached) return { nonce: cached, isNew: false };

  let db = null;
  try { db = require('./db'); } catch (e) { db = null; }

  if (db && typeof db.isEnabled === 'function' && db.isEnabled()) {
    try {
      const r = await db.claimAuthNonce(playerId, newNonce());
      if (r && r.nonce) {
        memClaims.set(playerId, r.nonce);
        return r;
      }
      return { failed: true };
    } catch (e) {
      // Fallo cerrado: mejor negar el acceso que conceder una identidad ajena.
      console.warn('[identidad] no se pudo reclamar en BD:', e.message);
      return { failed: true };
    }
  }

  // Modo degradado (sin BD): registro en memoria. No sobrevive a un reinicio,
  // que es exactamente el mismo alcance que tiene el resto de la persistencia.
  const nonce = newNonce();
  memClaims.set(playerId, nonce);
  return { nonce, isNew: true };
}

// ─── Handshake ───
// Se llama desde el evento 'hello'. Deja en `socket.data.identityReady` una
// promesa que se fija DE FORMA SÍNCRONA: los eventos que llegan justo detrás
// (el cliente emite `get_profile` en el mismo tick que `hello`) pueden
// esperarla con `ready(socket)` sin perderse la vinculación.
function beginHandshake(socket, { playerId, token } = {}) {
  if (!socket.data) socket.data = {};

  const promise = (async () => {
    const claimed = String(playerId || '').trim();
    if (!claimed) return { playerId: null, token: null, authed: false, reason: 'sin_id' };

    const claim = await claimIdentity(claimed);
    if (claim.failed) return { playerId: null, token: null, authed: false, reason: 'no_disponible' };

    // Identidad libre → se reclama aquí. Ya reclamada → hay que demostrarlo.
    const owns = claim.isNew || verifyToken(claimed, token, claim.nonce);
    if (!owns) {
      return { playerId: null, token: null, authed: false, reason: 'reclamada' };
    }

    socket.data.playerId = claimed;
    socket.data.authed = true;
    // El token solo se (re)emite a quien ya ha demostrado ser el dueño.
    return { playerId: claimed, token: issueToken(claimed, claim.nonce), authed: true };
  })();

  socket.data.identityReady = promise.catch(() => ({
    playerId: null, token: null, authed: false, reason: 'error'
  }));
  return socket.data.identityReady;
}

// Identidad autoritativa del socket, esperando al handshake si sigue en curso.
// Devuelve null si el socket nunca lo hizo o si no pudo demostrar la propiedad.
async function ready(socket) {
  if (socket && socket.data && socket.data.identityReady) {
    await socket.data.identityReady;
  }
  return currentId(socket);
}

// Versión síncrona: solo para caminos que ya saben que el handshake terminó.
function currentId(socket) {
  return (socket && socket.data && socket.data.playerId) || null;
}

function isAuthenticated(socket) {
  return !!(socket && socket.data && socket.data.authed);
}

// ¿Se permite una operación ECONÓMICA para la identidad del socket?
function canMutateEconomy(socket) {
  if (!STRICT) return true;
  return isAuthenticated(socket);
}

// Solo para pruebas: vacía el registro en memoria.
function _resetClaims() {
  memClaims.clear();
}

module.exports = {
  issueToken,
  verifyToken,
  claimIdentity,
  beginHandshake,
  ready,
  currentId,
  isAuthenticated,
  canMutateEconomy,
  _resetClaims,
  STRICT,
  TOKEN_TTL_MS,
  VERSION
};
