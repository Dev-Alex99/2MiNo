// Pruebas del motor de Uno.
//
// Todas las reglas del juego son lógica pura, así que se cubren aquí enteras:
// mazo, legalidad, efectos de cada carta, deuda de robo, cantar UNO, fin de
// ronda con puntuación y fin de partida. Las manos se montan a mano para que
// cada caso sea determinista (el reparto real baraja).

const assert = require('assert');
const GameRegistry = require('./core/GameRegistry');
const UnoGame = require('./games/UnoGame');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log(`✓ ${msg}`); passed++; }

const N = (color, valor) => ({ color, tipo: 'numero', valor });
const A = (color, tipo) => ({ color, tipo, valor: null });
const W = (tipo) => ({ color: null, tipo, valor: null });

/** Partida con manos y descarte fijados: nada de azar en las aserciones. */
function mesa({ manos, visible, color, pendingDraw = 0, jugadores = 2, maxScore = 200 }) {
  const g = GameRegistry.createGameInstance('uno', 'T', { maxScore });
  const nombres = ['Ana', 'Beto', 'Caro', 'Dani'];
  for (let i = 0; i < jugadores; i++) g.addPlayer('p' + i, nombres[i], 's' + i);
  g.startNewRound();
  manos.forEach((mano, i) => { g.players[i].hand = mano.slice(); });
  g.discard = [visible];
  g.currentColor = color || visible.color;
  g.pendingDraw = pendingDraw;
  g.currentPlayerIdx = 0;
  g.direction = 1;
  g.hasDrawnThisTurn = false;
  return g;
}

console.log('=== PRUEBAS DE UNO ===');

// ─── Mazo ───
(() => {
  const mazo = UnoGame.crearMazo();
  ok(mazo.length === 108, 'el mazo tiene 108 cartas');

  const cuenta = (f) => mazo.filter(f).length;
  ok(cuenta(c => c.tipo === 'numero') === 76, '76 cartas numéricas (un 0 y dos de cada 1-9 por color)');
  ok(cuenta(c => c.tipo === 'numero' && c.valor === 0) === 4, 'un solo 0 por color');
  ok(cuenta(c => c.tipo === 'numero' && c.valor === 7) === 8, 'dos sietes por color');
  for (const tipo of ['salta', 'cambio', 'mas2']) {
    ok(cuenta(c => c.tipo === tipo) === 8, `ocho cartas de tipo '${tipo}'`);
  }
  ok(cuenta(c => c.tipo === 'comodin') === 4 && cuenta(c => c.tipo === 'comodin_mas4') === 4,
    'cuatro comodines y cuatro +4');
  ok(cuenta(c => c.color === null) === 8, 'los comodines no tienen color hasta jugarse');

  ok(UnoGame.puntosDe(N('rojo', 7)) === 7, 'una carta numérica vale su número');
  ok(UnoGame.puntosDe(A('rojo', 'mas2')) === 20, 'las de acción valen 20');
  ok(UnoGame.puntosDe(W('comodin_mas4')) === 50, 'los comodines valen 50');
})();

// ─── Reparto ───
(() => {
  const g = GameRegistry.createGameInstance('uno', 'R', {});
  g.addPlayer('a', 'Ana', 'sa'); g.addPlayer('b', 'Beto', 'sb'); g.addPlayer('c', 'Caro', 'sc');
  ok(g.startNewGame() === true, 'la partida arranca con tres jugadores');
  ok(g.players.every(p => p.hand.length === 7), 'siete cartas a cada uno');
  ok(g.deck.length === 108 - 21 - 1, 'el mazo queda con el resto (menos la carta del descarte)');
  ok(!UnoGame.COMODINES.includes(g.cartaVisible().tipo),
    'la carta inicial nunca es un comodín (nadie empieza eligiendo color)');
  ok(g.currentColor === g.cartaVisible().color, 'el color en juego es el de la carta visible');

  const solo = GameRegistry.createGameInstance('uno', 'S', {});
  solo.addPlayer('a', 'Ana', 'sa');
  ok(solo.startNewGame() === false, 'no arranca con un solo jugador');
})();

// ─── Legalidad ───
(() => {
  const g = mesa({ manos: [[N('rojo', 5)], []], visible: N('azul', 5) });
  ok(g.esJugable(N('azul', 3)) === true, 'vale por color');
  ok(g.esJugable(N('rojo', 5)) === true, 'vale por número');
  ok(g.esJugable(N('rojo', 3)) === false, 'ni color ni número: no vale');
  ok(g.esJugable(W('comodin')) === true, 'el comodín siempre vale');
  ok(g.esJugable(W('comodin_mas4')) === true, 'el +4 siempre vale');
  ok(g.esJugable(A('rojo', 'salta')) === false, 'un salta de otro color sobre un número no vale');

  const conAccion = mesa({ manos: [[], []], visible: A('azul', 'salta') });
  ok(conAccion.esJugable(A('rojo', 'salta')) === true, 'acción con acción del mismo tipo sí vale');
  ok(conAccion.esJugable(A('rojo', 'mas2')) === false, 'acciones de tipos distintos no encadenan por símbolo');
})();

// ─── Deuda de robo: sólo se encadena ───
(() => {
  const g = mesa({ manos: [[N('rojo', 5), A('rojo', 'mas2')], []], visible: A('azul', 'mas2'), pendingDraw: 2 });
  ok(g.esJugable(N('rojo', 5)) === false, 'con un +2 encima no vale una carta normal aunque case el color');
  ok(g.esJugable(A('rojo', 'mas2')) === true, 'un +2 sí encadena');
  ok(g.esJugable(W('comodin_mas4')) === true, 'y un +4 también');
  ok(g.esJugable(W('comodin')) === false, 'un comodín normal NO sirve para escapar del +2');

  const sobreMas4 = mesa({ manos: [[], []], visible: W('comodin_mas4'), color: 'rojo', pendingDraw: 4 });
  ok(sobreMas4.esJugable(A('rojo', 'mas2')) === false, 'sobre un +4 no se encadena con un +2');
  ok(sobreMas4.esJugable(W('comodin_mas4')) === true, 'sobre un +4 sólo vale otro +4');
})();

// ─── Efectos ───
// Ojo: se dan cartas de sobra a quien juega. Con una sola en la mano, jugarla
// CIERRA la ronda y el efecto no llega a aplicarse (que es lo correcto, pero
// entonces el test no probaría el efecto).
(() => {
  // Salta: en una mesa de 3, el siguiente se queda sin turno.
  const g = mesa({ manos: [[A('rojo', 'salta'), N('rojo', 1)], [], []], visible: N('rojo', 5), jugadores: 3 });
  g.handleAction('p0', 'play', { index: 0 });
  ok(g.getCurrentPlayer().id === 'p2', 'salta se come el turno del siguiente');

  // Cambio de sentido con 3: invierte.
  const c = mesa({ manos: [[A('rojo', 'cambio'), N('rojo', 1)], [], []], visible: N('rojo', 5), jugadores: 3 });
  c.handleAction('p0', 'play', { index: 0 });
  ok(c.direction === -1, 'cambio invierte el sentido');
  ok(c.getCurrentPlayer().id === 'p2', 'y el turno va hacia el otro lado');

  // Cambio con 2 jugadores actúa como salta (regla real).
  const dos = mesa({ manos: [[A('rojo', 'cambio'), N('rojo', 1), N('rojo', 2)], []], visible: N('rojo', 5) });
  dos.handleAction('p0', 'play', { index: 0 });
  ok(dos.getCurrentPlayer().id === 'p0', 'con dos jugadores, cambio equivale a saltar (repites turno)');

  // +2 acumula deuda y pasa el turno.
  const d = mesa({ manos: [[A('rojo', 'mas2'), N('rojo', 1)], []], visible: N('rojo', 5) });
  d.handleAction('p0', 'play', { index: 0 });
  ok(d.pendingDraw === 2 && d.getCurrentPlayer().id === 'p1', '+2 deja deuda de 2 al siguiente');

  // Encadenar +2 acumula (con carta de repuesto: si no, cerraría la ronda).
  d.players[1].hand = [A('azul', 'mas2'), N('azul', 1)];
  d.handleAction('p1', 'play', { index: 0 });
  ok(d.pendingDraw === 4, 'encadenar otro +2 acumula la deuda a 4');

  // Quien no puede encadenar se lo traga entero y pierde el turno.
  const antes = d.players[0].hand.length;
  d.handleAction('p0', 'draw', {});
  ok(d.players[0].hand.length === antes + 4, 'quien no encadena roba las 4 acumuladas');
  ok(d.pendingDraw === 0, 'y la deuda se salda');
})();

// ─── Comodines ───
(() => {
  const g = mesa({ manos: [[W('comodin'), N('rojo', 1)], []], visible: N('rojo', 5) });
  ok(g.handleAction('p0', 'play', { index: 0 }).error === 'srv.err.pickColor',
    'jugar un comodín sin elegir color se rechaza');
  const r = g.handleAction('p0', 'play', { index: 0, color: 'verde' });
  ok(r.success === true, 'con color elegido sí se juega');
  ok(g.currentColor === 'verde', 'el color en juego pasa a ser el elegido');

  const cuatro = mesa({ manos: [[W('comodin_mas4'), N('rojo', 1)], []], visible: N('rojo', 5) });
  cuatro.handleAction('p0', 'play', { index: 0, color: 'azul' });
  ok(cuatro.pendingDraw === 4, 'el +4 deja deuda de 4');
  ok(cuatro.currentColor === 'azul', 'y también cambia el color');
})();

// ─── Cantar UNO ───
(() => {
  // Se declara AL JUGAR la penúltima. Sin declarar son +2 automáticas.
  const bien = mesa({ manos: [[N('rojo', 1), N('rojo', 2)], []], visible: N('rojo', 5) });
  bien.handleAction('p0', 'play', { index: 0, uno: true });
  ok(bien.players[0].hand.length === 1, 'cantando UNO te quedas con una carta');
  ok(bien.players[0].declaredUno === true, 'y queda constancia de que lo cantaste');

  const mal = mesa({ manos: [[N('rojo', 1), N('rojo', 2)], []], visible: N('rojo', 5) });
  const res = mal.handleAction('p0', 'play', { index: 0 });
  ok(res.penalizado === true, 'no cantar UNO se penaliza');
  ok(mal.players[0].hand.length === 3, 'la penalización son +2 cartas (1 + 2 = 3)');

  // Con más de dos cartas en mano, cantar no aplica.
  const lejos = mesa({ manos: [[N('rojo', 1), N('rojo', 2), N('rojo', 3)], []], visible: N('rojo', 5) });
  lejos.handleAction('p0', 'play', { index: 0 });
  ok(lejos.players[0].hand.length === 2, 'con tres cartas no hay penalización por no cantar');
})();

// ─── Robar ───
(() => {
  // Sin deuda: se roba una. Si no sirve, el turno pasa solo.
  const g = mesa({ manos: [[N('rojo', 1)], []], visible: N('azul', 9) });
  g.deck = [N('verde', 3)]; // no case con azul/9
  const r = g.robar(g.players[0]);
  ok(r.drew === 1 && g.players[0].hand.length === 2, 'robar sin deuda da una carta');
  ok(r.turnPassed === true && g.getCurrentPlayer().id === 'p1',
    'si la robada no sirve, el turno pasa sin tener que pulsar nada');

  // Si sirve, se puede jugar en el mismo turno.
  const g2 = mesa({ manos: [[N('rojo', 1)], []], visible: N('azul', 9) });
  g2.deck = [N('azul', 4)];
  const r2 = g2.robar(g2.players[0]);
  ok(r2.canPlayDrawn === true && g2.getCurrentPlayer().id === 'p0',
    'si la robada sí sirve, sigues siendo tú quien juega');
  ok(g2.robar(g2.players[0]).error === 'srv.err.alreadyDrew', 'no se puede robar dos veces en el turno');
  ok(g2.pasar(g2.players[0]).success === true, 'tras robar puedes pasar');
  ok(g2.getCurrentPlayer().id === 'p1', 'y el turno cambia');

  const g3 = mesa({ manos: [[N('rojo', 1)], []], visible: N('rojo', 9) });
  ok(g3.pasar(g3.players[0]).error === 'srv.err.mustDrawFirst', 'no se puede pasar sin haber robado');
})();

// ─── Reciclado del mazo ───
(() => {
  const g = mesa({ manos: [[N('rojo', 1)], []], visible: N('azul', 9) });
  g.deck = [];
  g.discard = [N('azul', 1), N('verde', 2), W('comodin'), N('azul', 9)];
  const carta = g.robarDelMazo();
  ok(!!carta, 'con el mazo vacío se recicla el descarte');
  ok(g.discard.length === 1 && g.discard[0].valor === 9, 'la carta visible se queda en el descarte');
  ok(g.deck.concat([carta]).every(c => !UnoGame.COMODINES.includes(c.tipo) || c.color === null),
    'los comodines reciclados vuelven sin color (no arrastran el color elegido)');
})();

// ─── Fin de ronda y de partida ───
(() => {
  const g = mesa({ manos: [[N('rojo', 1)], [N('azul', 9), A('azul', 'mas2'), W('comodin_mas4')]], visible: N('rojo', 5) });
  g.handleAction('p0', 'play', { index: 0, uno: true });
  ok(g.status === 'round_ended', 'quedarse sin cartas cierra la ronda');
  ok(g.roundWinnerId === 'p0', 'y marca al ganador');
  // 9 + 20 + 50 = 79
  ok(g.players[0].score === 79, 'el ganador suma el valor de las manos rivales (9+20+50=79)');

  // A los puntos objetivo, se acaba la partida.
  const corta = mesa({ manos: [[N('rojo', 1)], [W('comodin_mas4')]], visible: N('rojo', 5), maxScore: 200 });
  corta.players[0].score = 180;
  corta.handleAction('p0', 'play', { index: 0, uno: true });
  ok(corta.status === 'game_ended', 'al alcanzar los puntos objetivo termina la partida');
  ok(corta.getWinnerId() === 'p0', 'getWinnerId() devuelve el playerId ganador');
  ok(corta.getVariantLabel() === 'uno_200', 'el historial distingue la variante por puntos');
})();

// ─── La mano ajena no se ve ───
(() => {
  const g = mesa({ manos: [[N('rojo', 1), N('rojo', 2)], [N('azul', 9)]], visible: N('rojo', 5) });
  const vistaDeAna = g.getGameStateForPlayer('p0');
  const ana = vistaDeAna.players.find(p => p.id === 'p0');
  const beto = vistaDeAna.players.find(p => p.id === 'p1');
  ok(ana.hand.length === 2, 'ves tu propia mano');
  ok(beto.hand.length === 0 && beto.handCount === 1, 'del rival sólo ves CUÁNTAS cartas tiene');
  ok(Array.isArray(vistaDeAna.playableIndices) && vistaDeAna.playableIndices.length > 0,
    'el servidor dice qué cartas puedes jugar (el cliente no reimplementa las reglas)');

  const espectador = g.getSpectatorState();
  ok(espectador.players.every(p => p.hand.length === 0), 'un espectador no ve ninguna mano');

  g.terminarRonda(g.players[0]);
  const alFinal = g.getGameStateForPlayer('p0');
  ok(alFinal.players.find(p => p.id === 'p1').hand.length === 1,
    'al acabar la ronda se destapan las manos para poder contar');
})();

// ─── Bots ───
(() => {
  // Lo innegociable: un bot no puede jugar una carta ilegal, en ningún nivel.
  for (const nivel of ['facil', 'normal', 'dificil', 'maestro']) {
    let ilegales = 0, turnos = 0;
    for (let partida = 0; partida < 20; partida++) {
      const g = GameRegistry.createGameInstance('uno', 'B', {});
      g.addPlayer('h', 'Humano', 'sh');
      g.addBot('Bot', nivel);
      g.startNewGame();

      let guarda = 0;
      while (g.status === 'playing' && guarda++ < 200) {
        const turno = g.getCurrentPlayer();
        if (turno.isBot) {
          const antes = g.cartaVisible();
          const res = g.playBotTurn(turno.id);
          turnos++;
          if (res.action === 'played') {
            const ahora = g.cartaVisible();
            // Se comprueba contra el estado ANTERIOR que la jugada era legal.
            if (ahora === antes) ilegales++;
          }
        } else {
          // El humano juega lo primero legal, o roba.
          const op = g.jugablesDe(turno.id)[0];
          if (op) {
            g.handleAction(turno.id, 'play', {
              index: op.indice,
              color: 'rojo',
              uno: turno.hand.length === 2
            });
          } else {
            g.handleAction(turno.id, 'draw', {});
          }
        }
      }
    }
    ok(ilegales === 0 && turnos > 0, `[${nivel}] el bot jugó ${turnos} turnos sin una sola jugada ilegal`);
  }
})();

(() => {
  // El nivel difícil castiga a quien está a punto de cantar.
  const g = mesa({
    manos: [[N('rojo', 1), A('rojo', 'mas2'), W('comodin_mas4')], [N('azul', 9)]],
    visible: N('rojo', 5)
  });
  const jugada = g.elegirJugada(g.players[0], 'dificil');
  const elegida = g.players[0].hand[jugada.index];
  ok(elegida.tipo === 'comodin_mas4' || elegida.tipo === 'mas2',
    `difícil ataca al rival que va a cantar (jugó ${elegida.tipo})`);

  // Sin rival en peligro, guarda los comodines y suelta lo que más puntúa.
  const tranquilo = mesa({
    manos: [[N('rojo', 1), A('rojo', 'salta'), W('comodin')], [N('azul', 9), N('azul', 8), N('azul', 7)]],
    visible: N('rojo', 5)
  });
  const j2 = tranquilo.elegirJugada(tranquilo.players[0], 'normal');
  ok(tranquilo.players[0].hand[j2.index].tipo !== 'comodin', 'normal guarda el comodín para cuando haga falta');
  ok(tranquilo.players[0].hand[j2.index].tipo === 'salta', 'y suelta antes la carta de más valor');
})();

(() => {
  // El bot canta UNO al quedarse con una: si no, se autopenalizaría siempre.
  const g = mesa({ manos: [[N('rojo', 1), N('rojo', 2)], [N('azul', 9)]], visible: N('rojo', 5) });
  const jugada = g.elegirJugada(g.players[0], 'normal');
  ok(jugada.uno === true, 'el bot canta UNO al jugar su penúltima carta');
})();

// ─── Turno agotado ───
(() => {
  const g = mesa({ manos: [[N('rojo', 1), N('rojo', 2)], [N('azul', 9)]], visible: N('rojo', 5) });
  const r = g.forceTurn();
  ok(r && ['played', 'passed', 'none'].includes(r.action), `forceTurn() devuelve una acción válida ('${r.action}')`);
  ok(typeof r.drew === 'number', 'y un `drew` numérico (evita NaN al narrar el timeout)');
  ok(g.players[0].hand.length === 1, 'al agotarse el tiempo se juega por ti en vez de dejarte bloqueado');
})();

console.log(`\n=== TODAS LAS PRUEBAS DE UNO PASARON (${passed}) ===`);
