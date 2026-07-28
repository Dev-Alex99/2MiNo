// Hardening de red SIN dependencias externas (no se puede asumir helmet/
// express-rate-limit instalados). Cubre: allowlist de CORS, cabeceras de
// seguridad para las 2 rutas HTTP, rate-limit HTTP por IP para /ice-config y
// un rate-limit por socket (token bucket) que corta el spam de eventos.

// ─── CORS ───
// CLIENT_ORIGINS = lista separada por comas de orígenes permitidos.
// Si no se define, se permite cualquier origen (cómodo en desarrollo/red local).
function allowedOrigins() {
  const raw = (process.env.CLIENT_ORIGINS || '').trim();
  if (!raw) return null; // null ⇒ permitir todos (modo abierto)
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Origen para el paquete `cors` de Express y para Socket.IO. Acepta peticiones
// sin Origin (curl, health checks, apps nativas) y las del allowlist.
function corsOrigin(origin, cb) {
  const list = allowedOrigins();
  if (!list) return cb(null, true);          // modo abierto
  if (!origin) return cb(null, true);         // sin Origin (health, server-to-server)
  if (list.includes(origin)) return cb(null, true);
  return cb(new Error('Origen no permitido por CORS'), false);
}

const corsOptions = { origin: corsOrigin, methods: ['GET', 'POST'] };

// ─── Cabeceras de seguridad (helmet-lite) ───
// El cliente (Vercel) ya lleva su propia CSP en `client/vercel.json`. Estas son
// para el servidor, que sólo sirve dos endpoints JSON: /health e /ice-config.
function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-DNS-Prefetch-Control', 'off');
  res.set('Cross-Origin-Resource-Policy', 'same-site');

  // CSP mínima: este origen no sirve HTML ni scripts, así que se bloquea todo.
  // Si alguna vez una respuesta se interpretara como documento, no podría
  // cargar ni ejecutar nada.
  res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");

  // HSTS sólo cuando la petición llegó por HTTPS (en Render, vía el proxy).
  // Mandarlo en HTTP plano no hace nada y en desarrollo local forzaría https.
  const seguro = req.secure || req.get('x-forwarded-proto') === 'https';
  if (seguro) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  res.removeHeader('X-Powered-By');
  next();
}

// ─── Rate-limit HTTP por IP (ventana deslizante simple) ───
function httpRateLimit({ windowMs = 60000, max = 60 } = {}) {
  const hits = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
    arr.push(now);
    hits.set(ip, arr);
    // Limpieza oportunista para no crecer sin límite.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    }
    if (arr.length > max) {
      res.set('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'too_many_requests' });
    }
    next();
  };
}

// ─── Rate-limit por socket (token bucket) ───
// Dos cubos por conexión: uno general (todo evento) y uno "pesado" (eventos que
// escriben en BD o crean recursos). Si cualquiera se agota, el paquete se
// descarta silenciosamente (no se procesa el handler). Al ser por-socket, no
// afecta a otros jugadores.
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.last = null;
  }
  // now se pasa explícito para poder testear sin depender del reloj real.
  take(now, cost = 1) {
    if (this.last === null) this.last = now;
    const elapsed = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = now;
    if (this.tokens >= cost) { this.tokens -= cost; return true; }
    return false;
  }
}

// Eventos que tocan BD / crean salas / envían solicitudes: cubo estricto.
const HEAVY_EVENTS = new Set([
  'create_room', 'quick_play', 'join_room', 'friend_add', 'friend_respond',
  'friend_challenge', 'equip_skin', 'claim_mission', 'get_profile',
  'get_leaderboard', 'get_match_history', 'get_match_replay', 'get_friends',
  'join_queue', 'create_tournament', 'join_tournament', 'call_friend',
  'invite_to_pool'
]);

// Eventos de chat/emotes: cubo anti-spam.
const CHAT_EVENTS = new Set(['send_quick_message', 'send_emote']);

// Instala el rate-limit en un socket. Devuelve nada; usa socket.use().
function installSocketRateLimit(socket, { onDrop } = {}) {
  const general = new TokenBucket(60, 30);  // ~30 ev/s sostenido, ráfaga 60 (cubre señalización WebRTC)
  const heavy = new TokenBucket(12, 1);     // 1 op pesada/s sostenida, ráfaga 12
  const chat = new TokenBucket(8, 2);       // 2 mensajes/s, ráfaga 8
  let warned = 0;

  socket.use((packet, next) => {
    const now = Date.now();
    const event = Array.isArray(packet) ? packet[0] : null;

    if (!general.take(now)) return drop();
    if (event && HEAVY_EVENTS.has(event) && !heavy.take(now)) return drop();
    if (event && CHAT_EVENTS.has(event) && !chat.take(now)) return drop();
    return next();

    function drop() {
      // Avisar como mucho una vez cada pocos segundos para no realimentar el spam.
      if (now - warned > 3000) {
        warned = now;
        if (typeof onDrop === 'function') onDrop(socket);
        else socket.emit('error_msg', { key: 'srv.err.rateLimited' });
      }
      // No llamar next() ⇒ el paquete se descarta sin ejecutar el handler.
    }
  });
}

// ─── Tope de conexiones simultáneas por IP ───
// El rate-limit de arriba es POR SOCKET, así que se evadía abriendo sockets
// nuevos: mil conexiones desde una máquina daban mil cubos llenos. Esto pone
// techo a cuántas puede tener abiertas una misma IP a la vez.
//
// El valor por defecto es generoso a propósito: detrás de un CGNAT móvil o del
// NAT de una oficina hay muchos jugadores legítimos compartiendo IP, y cortar
// por lo sano dejaría fuera a gente real. Lo que se quiere frenar es una única
// máquina abriendo miles de sockets, no a una familia jugando en casa.
const MAX_SOCKETS_PER_IP = Math.max(4, Number(process.env.MAX_SOCKETS_PER_IP) || 40);

// Detrás de Render/Vercel la IP real viene en X-Forwarded-For; el primer valor
// es el cliente y el resto son los proxies por los que pasó.
function socketIp(socket) {
  const fwd = socket.handshake && socket.handshake.headers && socket.handshake.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (socket.handshake && socket.handshake.address) || 'desconocida';
}

// Crea el guardia. Se devuelve un objeto para poder probarlo sin levantar un
// servidor: `admit` decide, `release` libera al desconectar.
function createConnectionGuard({ max = MAX_SOCKETS_PER_IP } = {}) {
  const porIp = new Map();

  return {
    max,
    /** ¿Se admite una conexión más de esa IP? Si sí, la contabiliza. */
    admit(ip) {
      const n = (porIp.get(ip) || 0) + 1;
      if (n > max) return false;
      porIp.set(ip, n);
      return true;
    },
    release(ip) {
      const n = (porIp.get(ip) || 1) - 1;
      if (n <= 0) porIp.delete(ip);
      else porIp.set(ip, n);
    },
    count(ip) { return porIp.get(ip) || 0; },
    tracked() { return porIp.size; }
  };
}

// Instala el guardia en el servidor de Socket.IO.
function installConnectionLimit(io, opciones) {
  const guard = createConnectionGuard(opciones);

  io.use((socket, next) => {
    const ip = socketIp(socket);
    if (!guard.admit(ip)) {
      return next(new Error('demasiadas conexiones desde esta IP'));
    }
    if (!socket.data) socket.data = {};
    socket.data.ip = ip;
    socket.once('disconnect', () => guard.release(ip));
    next();
  });

  return guard;
}

module.exports = {
  allowedOrigins,
  corsOrigin,
  corsOptions,
  securityHeaders,
  httpRateLimit,
  installSocketRateLimit,
  createConnectionGuard,
  installConnectionLimit,
  socketIp,
  TokenBucket,
  HEAVY_EVENTS,
  CHAT_EVENTS,
  MAX_SOCKETS_PER_IP
};
