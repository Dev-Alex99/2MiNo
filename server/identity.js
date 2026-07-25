// Identidad de jugador vinculada al socket (mitiga la suplantación).
//
// Contexto: el `playerId` lo genera el cliente (localStorage) y hasta ahora el
// servidor confiaba a ciegas en el que venía en cada payload → cualquiera podía
// operar como otro jugador (gastar sus monedas, reclamar misiones, tocar sus
// amistades). Aquí se introduce:
//
//  1. VINCULACIÓN POR SOCKET (siempre activa, compatible hacia atrás): la primera
//     identidad que declara un socket queda fijada; el resto de operaciones de
//     ese socket usan esa identidad, ignorando lo que diga el payload. Así un
//     único socket no puede actuar como varias identidades.
//  2. TOKEN DE SESIÓN FIRMADO (HMAC): el servidor emite un token por jugador; el
//     cliente lo guarda y lo reenvía. Permite, en el futuro, exigirlo para las
//     operaciones económicas (modo estricto) sin cambiar el resto del protocolo.
//
// Sin dependencias externas: usa el módulo `crypto` de Node.

const crypto = require('crypto');

// Secreto para firmar. En producción, definir AUTH_SECRET (persistente entre
// reinicios). Si falta, se genera uno efímero por arranque (los tokens dejan de
// ser válidos tras reiniciar; suficiente para desarrollo).
let SECRET = process.env.AUTH_SECRET || '';
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[identidad] AUTH_SECRET no definido: usando secreto EFÍMERO (las sesiones no sobreviven a un reinicio).');
}

// Exigir token válido en operaciones económicas. Por defecto DESACTIVADO para no
// bloquear a los clientes que aún no tienen token; se activa con AUTH_STRICT=1
// una vez validado en staging.
const STRICT = /^(1|true|yes)$/i.test(process.env.AUTH_STRICT || '');

function sign(playerId) {
  return crypto.createHmac('sha256', SECRET).update(String(playerId)).digest('hex');
}

// Comparación en tiempo constante (evita fugas por temporización).
function verify(playerId, token) {
  if (!playerId || !token) return false;
  const expected = sign(playerId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Emite el token para un playerId (para enviárselo al cliente).
function issueToken(playerId) {
  return playerId ? sign(playerId) : null;
}

// Vincula (una sola vez) la identidad del socket. Devuelve:
//   { id, conflict, isNew }
// - id: identidad autoritativa del socket (la vinculada), o null si no hay.
// - conflict: true si el socket YA estaba vinculado a otra identidad distinta
//   (el llamador debe rechazar la operación).
// - isNew: true si se acaba de vincular en esta llamada.
function bind(socket, claimedId) {
  const already = socket.data && socket.data.playerId;
  if (already) {
    if (claimedId && String(claimedId) !== already) return { id: already, conflict: true, isNew: false };
    return { id: already, conflict: false, isNew: false };
  }
  if (!claimedId) return { id: null, conflict: false, isNew: false };
  if (!socket.data) socket.data = {};
  socket.data.playerId = String(claimedId);
  return { id: socket.data.playerId, conflict: false, isNew: true };
}

// Identidad autoritativa ya vinculada (sin vincular nada nuevo).
function currentId(socket) {
  return (socket.data && socket.data.playerId) || null;
}

// ¿Está el socket autenticado con token válido para esta identidad?
function isAuthenticated(socket) {
  return !!(socket.data && socket.data.authed);
}

// ¿Se permite una operación ECONÓMICA para la identidad vinculada del socket?
// En modo no estricto siempre se permite (solo aplica la vinculación por socket).
// En modo estricto exige token verificado.
function canMutateEconomy(socket) {
  if (!STRICT) return true;
  return isAuthenticated(socket);
}

module.exports = {
  sign,
  verify,
  issueToken,
  bind,
  currentId,
  isAuthenticated,
  canMutateEconomy,
  STRICT
};
