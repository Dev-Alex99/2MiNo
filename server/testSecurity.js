// Pruebas del hardening (server/security.js): token bucket, allowlist de CORS y
// tope de conexiones por IP. Corren con `node` puro (sin dependencias).
const assert = require('assert');
const { TokenBucket, corsOrigin, createConnectionGuard, socketIp } = require('./security');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

// ─── TokenBucket ───
(() => {
  const b = new TokenBucket(5, 1); // capacidad 5, +1/seg
  let t = 1000;
  // Debe permitir 5 seguidos (ráfaga = capacidad) y bloquear el 6º en el mismo instante.
  for (let i = 0; i < 5; i++) ok(b.take(t), `TokenBucket permite el evento en ráfaga #${i + 1}`);
  ok(!b.take(t), 'TokenBucket bloquea al superar la capacidad en ráfaga');

  // Tras 2 s se recargan 2 tokens ⇒ 2 permitidos y el 3º bloqueado.
  t += 2000;
  ok(b.take(t), 'TokenBucket recarga con el tiempo (1er token tras 2s)');
  ok(b.take(t), 'TokenBucket recarga con el tiempo (2º token tras 2s)');
  ok(!b.take(t), 'TokenBucket vuelve a bloquear tras gastar lo recargado');

  // Nunca excede la capacidad aunque pase mucho tiempo.
  t += 100000;
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (b.take(t)) allowed++;
  ok(allowed === 5, `TokenBucket no acumula por encima de la capacidad (permitió ${allowed}=5)`);
})();

// ─── CORS allowlist ───
(() => {
  const collect = (origin) => { let r; corsOrigin(origin, (_e, allow) => { r = allow; }); return r; };

  // Sin CLIENT_ORIGINS ⇒ modo abierto (permite cualquiera).
  delete process.env.CLIENT_ORIGINS;
  ok(collect('https://evil.example') === true, 'CORS abierto sin CLIENT_ORIGINS');

  // Con allowlist ⇒ solo los orígenes listados; peticiones sin Origin permitidas.
  process.env.CLIENT_ORIGINS = 'https://app.vercel.app, https://dominо.example';
  ok(collect('https://app.vercel.app') === true, 'CORS permite origen del allowlist');
  ok(collect('https://evil.example') === false, 'CORS bloquea origen fuera del allowlist');
  ok(collect(undefined) === true, 'CORS permite peticiones sin Origin (health/server-to-server)');
  delete process.env.CLIENT_ORIGINS;
})();

// ─── Tope de conexiones por IP ───
// El rate-limit por socket se evadía abriendo sockets nuevos: mil conexiones
// desde una máquina daban mil cubos llenos. Esto pone techo a las simultáneas.
(() => {
  const guard = createConnectionGuard({ max: 3 });

  ok(guard.admit('1.1.1.1'), 'admite la 1ª conexión de una IP');
  ok(guard.admit('1.1.1.1'), 'admite la 2ª');
  ok(guard.admit('1.1.1.1'), 'admite la 3ª (el tope)');
  ok(!guard.admit('1.1.1.1'), 'RECHAZA la 4ª: se alcanzó el tope de esa IP');

  // El tope es POR IP: otra dirección no queda penalizada por la primera.
  ok(guard.admit('2.2.2.2'), 'otra IP no se ve afectada por el tope de la primera');

  // Al desconectar se libera el hueco.
  guard.release('1.1.1.1');
  ok(guard.admit('1.1.1.1'), 'liberar una conexión deja sitio para otra');

  // El contador no se queda con IPs a cero (no crece sin límite).
  guard.release('2.2.2.2');
  ok(guard.count('2.2.2.2') === 0, 'una IP sin conexiones queda a cero');
  ok(!Object.is(guard.tracked(), undefined) && guard.tracked() === 1,
    'las IPs sin conexiones se olvidan (el Map no crece indefinidamente)');
})();

// ─── IP real detrás del proxy ───
// En Render el cliente llega por X-Forwarded-For; usar la IP del socket
// contaría a TODOS los jugadores como una sola dirección (la del proxy).
(() => {
  const conCabecera = { handshake: { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, address: '10.0.0.1' } };
  ok(socketIp(conCabecera) === '9.9.9.9', 'toma la IP del cliente, no la del proxy');

  const sinCabecera = { handshake: { headers: {}, address: '7.7.7.7' } };
  ok(socketIp(sinCabecera) === '7.7.7.7', 'sin cabecera usa la dirección del socket');

  ok(socketIp({}) === 'desconocida', 'un handshake incompleto no revienta');
})();

console.log(`\n=== TODAS LAS PRUEBAS DE SEGURIDAD PASARON (${passed}) ===`);
