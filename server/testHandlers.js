// Pruebas de INTEGRACIÓN sobre el servidor real (arranca `server.js` en un
// puerto propio y le habla con un cliente Socket.IO de verdad).
//
// Por qué existe esta suite: las otras 15 prueban lógica pura (reglas, poderes,
// torneos) y por eso no vieron ninguno de los cuatro fallos bloqueantes de la
// auditoría del 2026-07-27 — todos eran de CABLEADO y CICLO DE VIDA:
//   · `findMe` sin importar en gameHandler → un `start_game` anónimo mataba el
//     proceso entero (ReferenceError sin nadie que lo capturase).
//   · Sin guardas de proceso, cualquier excepción tiraba a todos los jugadores.
//   · `add_bot`/`remove_bot`/`swap_seats` no comprobaban pertenencia a la sala:
//     un extraño llenaba salas ajenas de bots hasta sacarlas del lobby.
// Un test de lógica pura nunca habría tocado esos caminos. Este sí.

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = Number(process.env.TEST_PORT) || 3987;
const URL = `http://localhost:${PORT}`;

let server;
let fallos = 0;

function ok(msg) { console.log(`✓ ${msg}`); }
function comprobar(cond, msg) {
  try { assert.ok(cond, msg); ok(msg); } catch (e) { fallos++; console.error(`✗ ${msg}`); }
}

// Arranca server.js como proceso hijo y espera a que anuncie que escucha.
function arrancarServidor() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      // Sin DATABASE_URL: modo degradado, que es como corre en CI.
      env: { ...process.env, PORT: String(PORT), AUTH_SECRET: 'test_secret_fijo' },
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

const pausa = (ms) => new Promise(r => setTimeout(r, ms));

// ¿Sigue vivo el proceso y atendiendo HTTP?
async function servidorVivo() {
  try {
    const r = await fetch(`${URL}/health`);
    return r.ok;
  } catch { return false; }
}

(async () => {
  console.log('=== PRUEBAS DE INTEGRACIÓN DE HANDLERS ===');
  await arrancarServidor();

  // ── C-1 + C-4: un evento anónimo no puede tumbar el servidor ───────────
  {
    const anonimo = await conectar();
    comprobar(await servidorVivo(), 'el servidor responde antes de la prueba');

    // Estos dos eventos usaban `findMe` sin importarlo: ReferenceError.
    anonimo.emit('start_game');
    await pausa(500);
    comprobar(await servidorVivo(), 'start_game de un socket anónimo NO tumba el servidor');

    anonimo.emit('game_action', { actionType: 'place', payload: {} });
    await pausa(500);
    comprobar(await servidorVivo(), 'game_action de un socket anónimo NO tumba el servidor');

    // Basura variada: nada de esto debe matar el proceso.
    anonimo.emit('game_action', { actionType: 'x'.repeat(500) });
    anonimo.emit('start_game', { basura: true });
    anonimo.emit('next_round', { roomId: 'NOEXISTE' });
    anonimo.emit('play_tile', { roomId: 'NOEXISTE', playerId: 'x', tileIndex: 0 });
    await pausa(600);
    comprobar(await servidorVivo(), 'una ráfaga de eventos malformados NO tumba el servidor');
    anonimo.close();
  }

  // ── C-3: solo los jugadores de la sala pueden manipularla ──────────────
  {
    const anfitrion = await conectar();
    anfitrion.emit('hello', { playerId: 'p_anfitrion' });
    anfitrion.emit('create_room', { name: 'Anfitrion', playerId: 'p_anfitrion', isPublic: true });
    const sala = await esperar(anfitrion, 'room_created');

    let estado = null;
    anfitrion.on('game_state', (s) => { estado = s; });
    await pausa(300);
    const iniciales = estado.players.length;

    // Un extraño que nunca entró en la sala: obtiene el roomId del lobby.
    const extranio = await conectar();
    extranio.emit('lobby_subscribe');
    const lista = await esperar(extranio, 'rooms_list');
    comprobar(lista.some(r => r.roomId === sala.roomId), 'el lobby publica el roomId (así se obtenía el objetivo)');

    for (let i = 0; i < 3; i++) {
      extranio.emit('add_bot', { roomId: sala.roomId, difficulty: 'dificil' });
      await pausa(150);
    }
    await pausa(400);
    comprobar(estado.players.length === iniciales,
      'un EXTRAÑO no puede meter bots en una sala ajena');

    extranio.emit('swap_seats', { roomId: sala.roomId, playerA: 'p_anfitrion', playerB: 'p_anfitrion' });
    extranio.emit('toggle_ready', { roomId: sala.roomId });
    await pausa(400);
    comprobar(estado.status === 'waiting',
      'un EXTRAÑO no puede forzar el arranque de una sala ajena');

    // ── Camino legítimo: el jugador de la sala SÍ puede (no romper la función) ──
    anfitrion.emit('add_bot', { roomId: sala.roomId, difficulty: 'normal' });
    await pausa(500);
    comprobar(estado.players.length === iniciales + 1,
      'un JUGADOR de la sala sí puede añadir un bot (el arreglo no rompe el flujo real)');

    const bot = estado.players.find(p => p.isBot);
    anfitrion.emit('remove_bot', { roomId: sala.roomId, botId: bot.id });
    await pausa(500);
    comprobar(estado.players.length === iniciales,
      'un JUGADOR de la sala sí puede quitar su bot');

    // El extraño tampoco puede quitar bots ajenos.
    anfitrion.emit('add_bot', { roomId: sala.roomId, difficulty: 'normal' });
    await pausa(500);
    const bot2 = estado.players.find(p => p.isBot);
    extranio.emit('remove_bot', { roomId: sala.roomId, botId: bot2.id });
    await pausa(400);
    comprobar(estado.players.some(p => p.id === bot2.id),
      'un EXTRAÑO no puede quitar los bots de una sala ajena');

    comprobar(await servidorVivo(), 'el servidor sigue en pie al terminar');
    anfitrion.close();
    extranio.close();
  }

  // ── C-2: el handshake no puede ser un oráculo de tokens ────────────────
  {
    const VICTIMA = 'p_victima_e2e';

    // La víctima reclama su identidad y recibe su token.
    const victima = await conectar();
    victima.emit('hello', { playerId: VICTIMA });
    const sesionVictima = await esperar(victima, 'session');
    comprobar(sesionVictima.authed === true && !!sesionVictima.token,
      'la dueña reclama su identidad y recibe token');

    // El atacante solo conoce el playerId (viaja en game_state). Lo pide.
    const atacante = await conectar();
    atacante.emit('hello', { playerId: VICTIMA });
    const sesionAtacante = await esperar(atacante, 'session');
    comprobar(!sesionAtacante.token,
      'el servidor NO entrega el token de una identidad ajena (fin del oráculo)');
    comprobar(sesionAtacante.authed === false,
      'el atacante no queda autenticado como la víctima');

    // Y sin identidad vinculada, la capa social no le atiende.
    let llegoPerfil = false;
    atacante.on('profile_data', () => { llegoPerfil = true; });
    atacante.emit('get_profile', { username: 'Atacante' });
    await pausa(700);
    comprobar(llegoPerfil === false,
      'un socket sin identidad demostrada no obtiene el perfil de nadie');

    // La dueña sí, reconectando con su token.
    const vuelve = await conectar();
    vuelve.emit('hello', { playerId: VICTIMA, token: sesionVictima.token });
    const sesionVuelve = await esperar(vuelve, 'session');
    comprobar(sesionVuelve.authed === true, 'la dueña reconecta con su token y recupera su identidad');

    // ── Carrera real del cliente: `hello` y `get_profile` en el mismo tick.
    // Si el handshake no se esperase, esta petición se perdería en silencio.
    const nuevo = await conectar();
    const perfil = new Promise(r => nuevo.once('profile_data', () => r(true)));
    nuevo.emit('hello', { playerId: 'p_carrera_e2e' });
    nuevo.emit('get_profile', { username: 'Nuevo' });
    const llego = await Promise.race([perfil, pausa(2500).then(() => false)]);
    comprobar(llego === true,
      'get_profile emitido en el mismo tick que hello SÍ se atiende (no hay carrera)');

    // ── A-1: la sala usa la identidad vinculada, no la del payload ────────
    const suplantador = await conectar();
    suplantador.emit('hello', { playerId: 'p_suplantador' });
    await esperar(suplantador, 'session');
    let estadoSup = null;
    suplantador.on('game_state', (s) => { estadoSup = s; });
    suplantador.emit('create_room', { name: 'Malo', playerId: VICTIMA, isPublic: false });
    await esperar(suplantador, 'room_created');
    await pausa(400);
    comprobar(estadoSup && estadoSup.players.every(p => p.id !== VICTIMA),
      'crear sala con el playerId de otro NO sienta a la víctima (se ignora el payload)');
    comprobar(estadoSup && estadoSup.players.some(p => p.id === 'p_suplantador'),
      'la sala se abre con la identidad realmente vinculada');

    // ── A-2: el cliente no puede declarar su sala clasificatoria ──────────
    const tramposo = await conectar();
    tramposo.emit('hello', { playerId: 'p_tramposo' });
    await esperar(tramposo, 'session');
    let estadoRanked = null;
    tramposo.on('game_state', (s) => { estadoRanked = s; });
    tramposo.emit('create_room', { name: 'Tramposo', ranked: true, isPublic: false });
    await esperar(tramposo, 'room_created');
    await pausa(400);
    comprobar(estadoRanked && estadoRanked.ranked === false,
      'create_room con ranked:true NO crea una sala clasificatoria (no se farmea ELO a medida)');
    tramposo.close();

    victima.close(); atacante.close(); vuelve.close(); nuevo.close(); suplantador.close();
  }

  server.kill();
  await pausa(300);

  if (fallos) {
    console.error(`\n=== ${fallos} PRUEBA(S) DE HANDLERS FALLARON ===`);
    process.exit(1);
  }
  console.log('\n=== TODAS LAS PRUEBAS DE INTEGRACIÓN DE HANDLERS PASARON ===');
  process.exit(0);
})().catch((e) => {
  console.error('Error en las pruebas de handlers:', e);
  if (server) server.kill();
  process.exit(1);
});
