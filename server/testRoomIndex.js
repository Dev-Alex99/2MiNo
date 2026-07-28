// Pruebas del índice socketId → sala que acelera `findMe`.
//
// `findMe` se llama en casi todos los eventos de socket y recorría TODAS las
// salas cada vez (con MAX_ROOMS=3000, 3000 búsquedas lineales por evento). Ahora
// hay un índice, pero el `socketId` de un jugador se reasigna desde varios
// sitios (reconexión, expulsión, abandono, desconexión), así que el índice se
// trata como CACHÉ: se valida contra la sala real en cada consulta.
//
// Lo que se prueba aquí es justo esa garantía: por muy obsoleta que esté la
// caché, `findMe` nunca devuelve un jugador equivocado.

const assert = require('assert');
const { rooms, findMe, forgetSocket } = require('./roomManager');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

// Sala mínima: a `findMe` sólo le hace falta `players`.
function salaFalsa(id, jugadores) {
  rooms.set(id, { players: jugadores });
  return rooms.get(id);
}

// Estado limpio por si otra suite dejó salas.
rooms.clear();

const ana = { id: 'p_ana', name: 'Ana', socketId: 's_ana' };
const beto = { id: 'p_beto', name: 'Beto', socketId: 's_beto' };
salaFalsa('AAAA', [ana]);
salaFalsa('BBBB', [beto]);

// ─── Búsqueda básica ───
(() => {
  const ctx = findMe('s_ana');
  ok(ctx && ctx.roomId === 'AAAA', 'encuentra la sala del socket');
  ok(ctx.player.id === 'p_ana', 'devuelve el jugador correcto');
  ok(findMe('s_inexistente') === null, 'un socket desconocido devuelve null');
})();

// ─── La segunda consulta usa la caché y sigue acertando ───
(() => {
  const ctx = findMe('s_ana');
  ok(ctx && ctx.roomId === 'AAAA' && ctx.player.id === 'p_ana',
    'la consulta cacheada devuelve lo mismo que el escaneo');
})();

// ─── Entrada obsoleta: el jugador cambia de socket (reconexión) ───
(() => {
  // Ana se reconecta con otro socket; el índice sigue apuntando al viejo.
  ana.socketId = 's_ana_nuevo';

  ok(findMe('s_ana') === null,
    'el socket VIEJO ya no encuentra nada (la caché obsoleta no miente)');
  const ctx = findMe('s_ana_nuevo');
  ok(ctx && ctx.player.id === 'p_ana', 'el socket nuevo encuentra a la jugadora');
})();

// ─── Entrada obsoleta: el jugador se va de la sala ───
(() => {
  findMe('s_beto'); // deja a Beto en la caché
  rooms.get('BBBB').players = [];
  ok(findMe('s_beto') === null, 'si el jugador ya no está en la sala, no se devuelve');
})();

// ─── Entrada obsoleta: la sala desaparece ───
(() => {
  const caro = { id: 'p_caro', name: 'Caro', socketId: 's_caro' };
  salaFalsa('CCCC', [caro]);
  ok(findMe('s_caro').roomId === 'CCCC', 'encuentra la sala nueva');

  rooms.delete('CCCC'); // se destruye sin pasar por destroyRoom
  ok(findMe('s_caro') === null, 'si la sala ya no existe, no se devuelve nada');
})();

// ─── El socketId reutilizado no hereda la sala del anterior ───
// Socket.IO genera ids nuevos, pero la caché no debe ser la razón por la que
// esto funcione: si un id se repitiera, la validación tiene que atraparlo.
(() => {
  const dani = { id: 'p_dani', name: 'Dani', socketId: 's_reciclado' };
  salaFalsa('DDDD', [dani]);
  ok(findMe('s_reciclado').player.id === 'p_dani', 'Dani encontrado en DDDD');

  rooms.delete('DDDD');
  const eva = { id: 'p_eva', name: 'Eva', socketId: 's_reciclado' };
  salaFalsa('EEEE', [eva]);

  const ctx = findMe('s_reciclado');
  ok(ctx && ctx.roomId === 'EEEE' && ctx.player.id === 'p_eva',
    'un socketId reutilizado resuelve a la sala NUEVA, no a la cacheada');
})();

// ─── forgetSocket ───
(() => {
  ok(findMe('s_ana_nuevo') !== null, 'Ana sigue localizable antes de olvidarla');
  forgetSocket('s_ana_nuevo');
  // Olvidar sólo tira la caché: como sigue en la sala, el escaneo la reencuentra.
  ok(findMe('s_ana_nuevo') !== null,
    'forgetSocket sólo limpia la caché; el jugador sigue localizable por escaneo');
})();

rooms.clear();
console.log(`\n=== TODAS LAS PRUEBAS DEL ÍNDICE DE SALAS PASARON (${passed}) ===`);
