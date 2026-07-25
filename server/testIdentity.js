// Pruebas de la identidad vinculada al socket (server/identity.js).
// Fija AUTH_SECRET antes de requerir el módulo (lo lee al cargarse).
process.env.AUTH_SECRET = 'test-secret-fijo-para-pruebas';
const assert = require('assert');
const identity = require('./identity');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

// ─── Firma / verificación de token ───
const tok = identity.issueToken('jugador_A');
ok(typeof tok === 'string' && tok.length === 64, 'issueToken devuelve un HMAC-SHA256 hex');
ok(identity.verify('jugador_A', tok), 'verify acepta el token correcto');
ok(!identity.verify('jugador_A', 'token_falso'), 'verify rechaza un token inválido');
ok(!identity.verify('jugador_B', tok), 'verify rechaza el token de otro jugador');
ok(!identity.verify('jugador_A', ''), 'verify rechaza token vacío');

// ─── Vinculación por socket ───
const mkSocket = () => ({ data: {}, emit() {} });

(() => {
  const s = mkSocket();
  const r1 = identity.bind(s, 'jugador_A');
  ok(r1.id === 'jugador_A' && r1.isNew && !r1.conflict, 'bind vincula la identidad la primera vez');

  const r2 = identity.bind(s, 'jugador_A');
  ok(r2.id === 'jugador_A' && !r2.isNew && !r2.conflict, 'bind con la misma identidad no genera conflicto');

  const r3 = identity.bind(s, 'jugador_VICTIMA');
  ok(r3.conflict && r3.id === 'jugador_A', 'bind con OTRA identidad marca conflicto (anti-suplantación) y conserva la original');

  ok(identity.currentId(s) === 'jugador_A', 'currentId devuelve la identidad vinculada');
})();

(() => {
  const s = mkSocket();
  const r = identity.bind(s, null);
  ok(r.id === null && !r.conflict, 'bind sin identidad no vincula nada');
})();

// ─── Modo no estricto: economía permitida sin token ───
ok(identity.canMutateEconomy(mkSocket()) === true, 'modo no estricto (por defecto) permite operaciones económicas');

console.log(`\n=== TODAS LAS PRUEBAS DE IDENTIDAD PASARON (${passed}) ===`);
