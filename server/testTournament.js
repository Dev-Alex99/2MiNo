// Pruebas del motor de torneos (sin sockets: io simulado).
const assert = require('assert');
const tm = require('./tournamentManager');
const { rooms } = require('./roomManager');

const io = { to: () => ({ emit: () => {} }) };
const mkSocket = (id) => ({ id, emit: () => {} });

function ok(msg) { console.log('✓ ' + msg); }

// 1. Simulación bot-vs-bot: siempre termina con ganador válido.
for (let i = 0; i < 30; i++) {
  const w = tm.simulateBotMatch();
  assert(w === 'a' || w === 'b');
}
ok('simulateBotMatch: 30 partidas simuladas terminan con ganador válido');

// ── Escenario A: SOLO (1 humano + 3 bots) ──
const t1 = tm.createTournament(io, mkSocket('s1'), { id: 'solo', name: 'Solo' });
assert.strictEqual(t1.status, 'lobby');
assert.strictEqual(t1.humans.length, 1);
tm.startTournament(io, t1.id, 's1');
assert.strictEqual(t1.seeds[0].isHuman, true, 'humano en plaza 0');
assert(t1.bracket.sf1.roomId && rooms.has(t1.bracket.sf1.roomId), 'SF1 real');
assert(t1.bracket.sf2.winner != null, 'SF2 (bots) simulada al arrancar');
assert.strictEqual(tm.publicState(t1, t1.humans[0]).yourMatchRoomId, t1.bracket.sf1.roomId, 'yourMatchRoomId = SF1');
tm.onMatchEnd(io, t1.bracket.sf1.roomId, 'solo'); // gana el humano
assert.strictEqual(t1.bracket.final.a, 0, 'humano en la final');
assert(t1.bracket.final.roomId && rooms.has(t1.bracket.final.roomId), 'final real creada');
tm.onMatchEnd(io, t1.bracket.final.roomId, 'solo'); // gana la final
assert.strictEqual(t1.status, 'finished');
assert.strictEqual(t1.championSeed, 0, 'campeón = humano');
ok('SOLO: 1 humano gana SF1 y final → campeón');

// ── Escenario B: 2 HUMANOS (semifinales reales concurrentes) ──
const tB = tm.createTournament(io, mkSocket('sA'), { id: 'A', name: 'Ana' });
tm.joinTournament(io, mkSocket('sB'), tB.id, { id: 'B', name: 'Beto' });
assert.strictEqual(tB.humans.length, 2, 'dos humanos en el lobby');
tm.startTournament(io, tB.id, 'sA');

// Siembra [0,2,1,3]: Ana→0, Beto→2. Ambas semis con humano ⇒ dos salas reales.
const seedA = tB.seeds.findIndex(s => s.isHuman && s.id === 'A');
const seedB = tB.seeds.findIndex(s => s.isHuman && s.id === 'B');
assert.strictEqual(seedA, 0, 'Ana en plaza 0');
assert.strictEqual(seedB, 2, 'Beto en plaza 2');
const sf1Room = tB.bracket.sf1.roomId, sf2Room = tB.bracket.sf2.roomId;
assert(sf1Room && rooms.has(sf1Room) && sf2Room && rooms.has(sf2Room), 'dos semifinales reales');
assert.strictEqual(tB.bracket.sf1.winner, null, 'ninguna semi decidida aún');

// Ana gana su semi; la final NO debe empezar hasta que termine la otra.
tm.onMatchEnd(io, sf1Room, 'A');
assert.strictEqual(tB.bracket.sf1.winner, 0);
assert.strictEqual(tB.bracket.final.roomId, null, 'la final espera a la otra semifinal');
// Estado de Ana: ganó su semi y espera (sin partida pendiente).
assert.strictEqual(tm.publicState(tB, tB.humans[0]).yourMatchRoomId, null, 'Ana en espera');

// Beto gana su semi → ahora sí arranca la final (Ana vs Beto, ambos humanos).
tm.onMatchEnd(io, sf2Room, 'B');
assert.strictEqual(tB.bracket.sf2.winner, 2);
assert.strictEqual(tB.bracket.final.a, 0);
assert.strictEqual(tB.bracket.final.b, 2);
assert(tB.bracket.final.roomId && rooms.has(tB.bracket.final.roomId), 'final real (humano vs humano)');

// Ana gana la final.
tm.onMatchEnd(io, tB.bracket.final.roomId, 'A');
assert.strictEqual(tB.status, 'finished');
assert.strictEqual(tB.championSeed, 0, 'campeona = Ana');
assert.strictEqual(tm.publicState(tB, tB.humans[1]).youSeed, 2, 'Beto sabe que es la plaza 2');
ok('2 HUMANOS: semis concurrentes, la final espera a ambas, campeón correcto');

console.log('\n=== TODAS LAS PRUEBAS DE TORNEO PASARON ===');
process.exit(0);
