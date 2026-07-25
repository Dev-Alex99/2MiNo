// Pruebas del hardening (server/security.js): token bucket y allowlist de CORS.
// Corren con `node` puro (sin dependencias).
const assert = require('assert');
const { TokenBucket, corsOrigin } = require('./security');

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

console.log(`\n=== TODAS LAS PRUEBAS DE SEGURIDAD PASARON (${passed}) ===`);
