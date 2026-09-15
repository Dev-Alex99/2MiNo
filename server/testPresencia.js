// Pruebas de la presencia (server/presence.js): multipestaña, actividad
// agregada y disponibilidad.
//
// Por qué existe: el área no tenía NI UNA aserción. `presence` decide si un
// jugador es visible y llamable, y su parte más delicada —que un jugador con
// dos pestañas no se «desconecte» al cerrar una— nunca se había probado. La
// agregación por prioridad se añade ahora, y con ella el riesgo concreto de
// que dos pestañas del mismo jugador (una en el hub, otra en partida) se pisen
// turnándose para decir cosas contrarias.
//
// Módulo puro: no arranca servidor, no toca red y no toca la base de datos.

const assert = require('assert');
const presence = require('./presence');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

console.log('=== PRUEBAS DE PRESENCIA ===');

// ─── 1. Multipestaña: online mientras quede un socket ───
(() => {
  presence._reset();

  const a = presence.register('s1', 'p_ana');
  ok(a.becameOnline === true, 'el PRIMER socket de un jugador lo pone online');

  const b = presence.register('s2', 'p_ana');
  ok(b.becameOnline === false, 'una segunda pestaña NO vuelve a anunciar que se conectó');
  ok(presence.socketsOf('p_ana').size === 2, 'las dos pestañas quedan registradas');

  const c = presence.unregister('s1');
  ok(c.becameOffline === false && c.playerId === 'p_ana',
    'cerrar UNA pestaña no deja al jugador offline (era el fallo que haría desaparecer a media sala)');
  ok(presence.isOnline('p_ana') === true, 'sigue online con la pestaña que queda');

  const d = presence.unregister('s2');
  ok(d.becameOffline === true, 'cerrar la ÚLTIMA sí lo pone offline');
  ok(presence.isOnline('p_ana') === false && presence.socketsOf('p_ana') === null,
    'y el índice no se queda con conjuntos vacíos');

  ok(presence.unregister('s_desconocido').becameOffline === false,
    'desregistrar un socket que nunca existió no revienta');
})();

// ─── 2. Un socket que cambia de identidad no duplica la anterior ───
(() => {
  presence._reset();
  presence.register('s1', 'p_ana');
  presence.register('s1', 'p_beto');   // mismo socket, otra identidad
  ok(presence.isOnline('p_ana') === false, 'reasignar un socket saca la identidad anterior');
  ok(presence.playerOf('s1') === 'p_beto', 'y el índice inverso apunta a la nueva');
})();

// ─── 3. Nombres: el servidor pone él el nombre de quien llama ───
(() => {
  presence._reset();
  ok(presence.nombreDe('p_nadie') === 'Jugador', 'una cuenta desconocida no tiene nombre inventado');

  presence.recordarNombre('p_ana', '   Ana   ');
  ok(presence.nombreDe('p_ana') === 'Ana', 'el nombre se recorta de espacios');

  presence.recordarNombre('p_ana', 'A'.repeat(50));
  ok(presence.nombreDe('p_ana').length === 20, 'y se corta a 20, como el resto del servidor');

  presence.recordarNombre('p_ana', '   ');
  ok(presence.nombreDe('p_ana').length === 20, 'un nombre vacío no borra el que ya había');
})();

// ─── 4. Actividad AGREGADA sobre el conjunto de pestañas ───
// Fijarla por «el último socket que habló» haría que dos pestañas del mismo
// jugador se turnaran para contradecirse. Gana la de mayor prioridad.
(() => {
  presence._reset();
  presence.register('s_hub', 'p_ana');
  presence.register('s_partida', 'p_ana');

  ok(presence.actividadDe('p_ana').estado === 'libre',
    'sin actividad declarada, un jugador conectado está libre');

  presence.setActividad('s_hub', { estado: 'libre' });
  presence.setActividad('s_partida', { estado: 'jugando', roomId: 'ABCD' });
  const act = presence.actividadDe('p_ana');
  ok(act.estado === 'jugando' && act.roomId === 'ABCD',
    'la pestaña que juega gana a la que está en el hub (y arrastra su sala)');

  presence.setActividad('s_hub', { estado: 'en_llamada' });
  ok(presence.actividadDe('p_ana').estado === 'en_llamada',
    'estar en una llamada gana a estar jugando');

  ok(presence.actividadDe('p_fantasma').estado === 'desconectado',
    'quien no tiene sockets sale como desconectado, no como libre');

  // Cerrar la pestaña que jugaba deja de contaminar la agregación.
  presence.unregister('s_partida');
  presence.setActividad('s_hub', { estado: 'en_sala', roomId: 'WXYZ' });
  ok(presence.actividadDe('p_ana').estado === 'en_sala',
    'al cerrar una pestaña su actividad se olvida (no queda «jugando» para siempre)');

  presence.setActividad('s_hub', { estado: 'inventado' });
  ok(presence.actividadDe('p_ana').estado === 'libre',
    'un estado que no está en la tabla de prioridad degrada a libre en vez de colarse');
})();

// ─── 5. «No molestar» es del JUGADOR y gana a todas sus pestañas ───
(() => {
  presence._reset();
  presence.register('s1', 'p_ana');
  presence.setActividad('s1', { estado: 'jugando', roomId: 'ABCD' });

  ok(presence.disponibilidadDe('p_ana') === 'libre', 'por defecto se está disponible');

  presence.setDisponibilidad('p_ana', 'no_molestar');
  const act = presence.actividadDe('p_ana');
  ok(act.estado === 'no_molestar', 'no molestar se impone a lo que digan las pestañas');
  ok(act.roomId === null, 'y no filtra en qué sala está: no molestar es no dar detalles');

  // Es una decisión del jugador, no del estado de su conexión: sobrevive a
  // cerrar la pestaña. Si se borrara al desconectar, bastaría una reconexión de
  // móvil para volver a estar disponible sin haberlo pedido.
  presence.unregister('s1');
  presence.register('s2', 'p_ana');
  ok(presence.disponibilidadDe('p_ana') === 'no_molestar',
    'no molestar sobrevive a una reconexión');

  presence.setDisponibilidad('p_ana', 'libre');
  ok(presence.disponibilidadDe('p_ana') === 'libre', 'y se puede volver a estar disponible');
})();

console.log(`\n=== TODAS LAS PRUEBAS DE PRESENCIA PASARON (${passed}) ===`);
