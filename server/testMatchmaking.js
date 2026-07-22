// Prueba del emparejamiento clasificatorio (sin sockets reales).
const assert = require('assert');
const mm = require('./matchmaking');
const { rooms } = require('./roomManager');

const emits = [];
const io = { to: (sid) => ({ emit: (ev, data) => emits.push({ sid, ev, data }) }) };
const mkSocket = (id) => ({ id, emit: (ev, data) => emits.push({ sid: id, ev, data }) });

function ok(m) { console.log('✓ ' + m); }

(async () => {
  // Primer jugador entra: queda esperando.
  await mm.joinQueue(io, mkSocket('s1'), { id: 'p1', name: 'Uno' });
  assert.strictEqual(mm.queueSize(), 1, 'un jugador esperando');
  assert(!emits.some(e => e.ev === 'match_found'), 'aún sin emparejar');
  ok('joinQueue: primer jugador queda en cola');

  // Segundo jugador entra: se empareja.
  await mm.joinQueue(io, mkSocket('s2'), { id: 'p2', name: 'Dos' });
  assert.strictEqual(mm.queueSize(), 0, 'cola vacía tras emparejar');

  const found = emits.filter(e => e.ev === 'match_found');
  assert.strictEqual(found.length, 2, 'match_found emitido a ambos');
  const roomId = found[0].data.roomId;
  assert(found.every(e => e.data.roomId === roomId), 'misma sala para ambos');
  assert.deepStrictEqual(found.map(e => e.sid).sort(), ['s1', 's2'], 'notificados s1 y s2');
  ok('joinQueue: segundo jugador dispara emparejamiento y match_found');

  // La sala creada es clasificatoria (ELO) con dos humanos.
  const game = rooms.get(roomId);
  assert(game, 'sala creada');
  assert.strictEqual(game.ranked, true, 'sala ranked (afecta ELO)');
  assert.strictEqual(game.players.length, 2, 'dos jugadores');
  assert(game.players.every(p => !p.isBot), 'ambos humanos');
  assert.strictEqual(game.powersEnabled, false, 'sin poderes');
  ok('createRankedMatch: sala 1v1 ranked sin poderes con dos humanos');

  // leaveQueue no rompe con cola vacía.
  mm.leaveQueue('sX');
  assert.strictEqual(mm.queueSize(), 0);
  ok('leaveQueue: seguro con cola vacía');

  console.log('\n=== TODAS LAS PRUEBAS DE EMPAREJAMIENTO PASARON ===');
  process.exit(0);
})();
