// Pruebas de la identidad vinculada al socket (server/identity.js).
// Fija AUTH_SECRET antes de requerir el módulo (lo lee al cargarse).
process.env.AUTH_SECRET = 'test-secret-fijo-para-pruebas';
const assert = require('assert');
const identity = require('./identity');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

const mkSocket = () => ({ data: {}, emit() {} });
const NONCE_A = 'nonce_de_A';
const NONCE_B = 'nonce_de_B';

(async () => {
  // ─── Token v2: firma, caducidad y aislamiento entre cuentas ───
  const tok = identity.issueToken('jugador_A', NONCE_A);
  ok(typeof tok === 'string' && tok.startsWith('v2.'), 'issueToken emite un token versionado v2');
  ok(identity.verifyToken('jugador_A', tok, NONCE_A), 'verifyToken acepta el token correcto');
  ok(!identity.verifyToken('jugador_A', 'token_falso', NONCE_A), 'verifyToken rechaza un token inválido');
  ok(!identity.verifyToken('jugador_B', tok, NONCE_B), 'verifyToken rechaza el token de otro jugador');
  ok(!identity.verifyToken('jugador_A', tok, ''), 'verifyToken rechaza si falta el nonce de la cuenta');
  ok(!identity.verifyToken('jugador_A', '', NONCE_A), 'verifyToken rechaza un token vacío');

  // El nonce es el mecanismo de REVOCACIÓN: cambiarlo invalida lo ya emitido.
  ok(!identity.verifyToken('jugador_A', tok, 'nonce_rotado'),
    'rotar el nonce de la cuenta invalida los tokens anteriores (revocación)');

  // Caducidad: un token emitido hace más de su TTL ya no vale.
  const viejo = identity.issueToken('jugador_A', NONCE_A, Date.now() - identity.TOKEN_TTL_MS - 1000);
  ok(!identity.verifyToken('jugador_A', viejo, NONCE_A), 'verifyToken rechaza un token caducado');

  // El token de un id NO se puede derivar del de otro: distinta firma.
  ok(identity.issueToken('jugador_A', NONCE_A) !== identity.issueToken('jugador_B', NONCE_A),
    'dos identidades distintas nunca comparten token');

  // ─── C-2: el handshake ya NO es un oráculo de tokens ───
  identity._resetClaims();

  // 1) La víctima llega primero: identidad libre → la reclama y recibe token.
  const sVictima = mkSocket();
  const rVictima = await identity.beginHandshake(sVictima, { playerId: 'p_victima' });
  ok(rVictima.authed && rVictima.token, 'la 1ª conexión con un id libre lo reclama y recibe token');
  ok(identity.currentId(sVictima) === 'p_victima', 'el socket de la víctima queda vinculado a su identidad');

  // 2) El atacante conoce el playerId (viaja en game_state) pero no el token.
  const sAtacante = mkSocket();
  const rAtacante = await identity.beginHandshake(sAtacante, { playerId: 'p_victima' });
  ok(rAtacante.authed === false, 'pedir una identidad YA reclamada sin token NO autentica');
  ok(!rAtacante.token, 'el servidor NO emite el token de una identidad ajena (fin del oráculo)');
  ok(rAtacante.reason === 'reclamada', 'se informa del motivo del rechazo');
  ok(identity.currentId(sAtacante) === null,
    'el socket del atacante NO queda vinculado (antes se vinculaba aunque no autenticase)');

  // 3) Tampoco cuela con un token inventado.
  const sFalso = mkSocket();
  const rFalso = await identity.beginHandshake(sFalso, { playerId: 'p_victima', token: 'v2.99999999999999.deadbeef' });
  ok(!rFalso.authed && identity.currentId(sFalso) === null, 'un token falsificado no vincula la identidad ajena');

  // 4) La víctima reconecta con SU token: sí entra.
  const sVuelve = mkSocket();
  const rVuelve = await identity.beginHandshake(sVuelve, { playerId: 'p_victima', token: rVictima.token });
  ok(rVuelve.authed && identity.currentId(sVuelve) === 'p_victima',
    'la dueña reconecta con su token y recupera su identidad');
  ok(rVuelve.token && rVuelve.token !== 'undefined', 'al reconectar se renueva el token (no caduca jugando)');

  // 5) Un id nuevo distinto sigue funcionando con normalidad.
  const sOtro = mkSocket();
  const rOtro = await identity.beginHandshake(sOtro, { playerId: 'p_otro' });
  ok(rOtro.authed && identity.currentId(sOtro) === 'p_otro', 'un jugador nuevo reclama su propio id sin fricción');

  // 6) Sin playerId no se vincula nada.
  const sVacio = mkSocket();
  const rVacio = await identity.beginHandshake(sVacio, {});
  ok(!rVacio.authed && identity.currentId(sVacio) === null, 'un handshake sin identidad no vincula nada');

  // ─── ready(): espera al handshake en curso (el cliente emite get_profile
  // en el mismo tick que hello, así que no puede perderse la vinculación) ───
  identity._resetClaims();
  const sCarrera = mkSocket();
  identity.beginHandshake(sCarrera, { playerId: 'p_carrera' }); // SIN await, como en el server
  ok(identity.currentId(sCarrera) === null, 'antes de resolver el handshake aún no hay identidad síncrona');
  const idTrasEsperar = await identity.ready(sCarrera);
  ok(idTrasEsperar === 'p_carrera', 'ready() espera al handshake y devuelve la identidad ya vinculada');

  // Un socket que nunca hizo handshake no obtiene identidad.
  ok((await identity.ready(mkSocket())) === null, 'ready() de un socket sin handshake devuelve null');

  // ─── Economía ───
  ok(identity.canMutateEconomy(sVuelve) === true, 'un socket autenticado puede operar con su economía');

  console.log(`\n=== TODAS LAS PRUEBAS DE IDENTIDAD PASARON (${passed}) ===`);
})().catch((e) => {
  console.error('✗ Falló una prueba de identidad:', e.message);
  process.exit(1);
});
