// LA FRONTERA DE LA TRAMPA.
//
// Un bot solo puede razonar sobre lo que un humano sentado a la mesa también
// ve: las fichas jugadas, los pases registrados, cuántas fichas le quedan a
// cada cual y el tamaño del pozo. Hasta ahora eso era una promesa: chooseMove
// recibía el objeto DominoGame entero y `game.players[1].hand` estaba a un
// punto de distancia. Una trampa así no la detecta ningún test —el bot ganaría
// más y todo seguiría en verde—, así que aquí se convierte en un TIPO DE DATO:
// buildObservation devuelve un objeto congelado, sin referencia al juego, que
// solo contiene información pública, y el cerebro de botLogic.js no recibe
// ninguna otra cosa.
//
// Prueba de que la frontera aguanta (testBotLevels.js): si se permutan las
// manos rivales y el pozo dejando intactos handCount y boneyardCount, la
// observación resultante es DEEP-EQUAL a la anterior. No es una convención de
// estilo: es una igualdad comprobable.
//
// La única lectura del motor que hace este módulo y que podría parecer
// sospechosa es game.getValidMoves(botId): solo mira MI mano, los extremos y
// los bloqueos activos —todo público para mí—, y se llama aquí para no
// duplicar las reglas de legalidad (comodín, extremo congelado, maldición) en
// un segundo sitio que se desincronizaría al primer cambio del motor.

// Fichas de la variante: doble 6 = 28, doble 9 = 55.
function fichasDelMazo(maxPip) {
  return ((maxPip + 1) * (maxPip + 2)) / 2;
}

// Mazo completo de la variante, en orden canónico (i <= j).
function mazoDe(maxPip) {
  const mazo = [];
  for (let i = 0; i <= maxPip; i++) {
    for (let j = i; j <= maxPip; j++) mazo.push([i, j]);
  }
  return mazo;
}

// Clave de ficha independiente de la orientación: [5,2] y [2,5] son la MISMA
// ficha física, y el tablero las guarda giradas.
function claveFicha(tile) {
  return tile[0] <= tile[1] ? `${tile[0]}:${tile[1]}` : `${tile[1]}:${tile[0]}`;
}

// Extremos que quedarían tras colocar `tile` por `side`. Réplica exacta de la
// convención de DominoGame.playTile —incluida la del comodín, que voltea al
// revés—, en forma pura para que el cerebro pueda simular varias jugadas
// seguidas sin tocar el motor. testBotLevels.js comprueba que ambas coinciden
// sobre posiciones al azar; si el motor cambia de convención, salta ahí.
function extremosTras(izq, der, tile, side, comodin = false) {
  if (izq === null || der === null) return { izq: tile[0], der: tile[1] };
  if (comodin) {
    if (side === 'left') return { izq: tile[0] === izq ? tile[1] : tile[0], der };
    return { izq, der: tile[1] === der ? tile[0] : tile[1] };
  }
  if (side === 'left') return { izq: tile[1] === izq ? tile[0] : tile[1], der };
  return { izq, der: tile[0] === der ? tile[1] : tile[0] };
}

// ¿Encaja esta ficha en alguno de los extremos?
function encaja(tile, izq, der) {
  return tile[0] === izq || tile[1] === izq || tile[0] === der || tile[1] === der;
}

// Combinaciones C(n, k) en coma flotante. n nunca pasa de 55 aquí, así que el
// producto acumulado no se acerca a los límites del doble.
function combinaciones(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < kk; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * Observación pública de la mesa desde el asiento de `botId`.
 *
 * Devuelve un objeto CONGELADO sin referencia al juego. Todo lo que contiene
 * lo puede ver cualquiera sentado a la mesa; los derivados (unseen,
 * remainingBySuit, pTiene) son cuentas sobre esa misma información.
 */
function buildObservation(game, botId) {
  const yo = game.players.find(p => p.id === botId);
  if (!yo) return null;

  const maxPip = game.maxPip || 6;
  const board = (game.board || []).map(t => [t[0], t[1]]);
  const miMano = (yo.hand || []).map(t => [t[0], t[1]]);

  const izq = board.length ? board[0][0] : null;
  const der = board.length ? board[board.length - 1][1] : null;

  // Orden de juego: el asiento manda. `reversed` lo invierte, y con eso basta
  // para saber quién juega inmediatamente después de mí, que es el rival al
  // que más duele un bloqueo.
  const orden = game.players.map(p => p.id);
  const efectos = game.activeEffects || {};
  const miIndice = orden.indexOf(botId);

  const handCounts = {};
  const drawCounts = {};
  const equipos = {};
  const marcador = {};
  const escudos = {};
  const poderesCount = {};
  const esBot = {};
  game.players.forEach(p => {
    handCounts[p.id] = p.hand ? p.hand.length : 0; // .length, nunca el contenido
    drawCounts[p.id] = 0;
    equipos[p.id] = p.team || 0;
    marcador[p.id] = p.score || 0;
    escudos[p.id] = !!p.shieldActive;
    poderesCount[p.id] = p.powers ? p.powers.length : 0;
    esBot[p.id] = !!p.isBot;
  });

  // Robos del pozo: los cuenta el historial, que se difunde a toda la mesa.
  // Está aquí porque forma parte del estado público —quien robó cuatro veces y
  // sigue sin soltar el 5 casi seguro no tiene el 5—, aunque las heurísticas de
  // hoy todavía no lo exploten: la observación describe LO QUE SE VE, no lo que
  // el cerebro de turno usa.
  const nombreA = {};
  game.players.forEach(p => { nombreA[p.name] = p.id; });
  (game.moveLog || []).forEach(e => {
    if (e && e.action === 'draw') {
      const id = nombreA[e.player];
      if (id) drawCounts[id]++;
    }
  });

  // Pases: copia defensiva, ya limpia de los pases falsos (passTurn solo
  // registra los que revelan algo y olvidarPases borra los envenenados).
  const passedOn = {};
  Object.keys(game.playerPassedOn || {}).forEach(id => {
    passedOn[id] = [...(game.playerPassedOn[id] || [])];
  });
  orden.forEach(id => { if (!passedOn[id]) passedOn[id] = []; });

  // No vistas = mazo completo - mi mano - tablero. Están repartidas entre las
  // manos rivales y el pozo, y no hay forma legítima de saber dónde: por eso
  // el conjunto va sin dueño y en orden canónico (así dos observaciones de la
  // misma posición son deep-equal aunque el reparto oculto sea distinto).
  const vistas = new Set();
  miMano.forEach(t => vistas.add(claveFicha(t)));
  board.forEach(t => vistas.add(claveFicha(t)));
  const unseen = mazoDe(maxPip).filter(t => !vistas.has(claveFicha(t)));

  const remainingBySuit = new Array(maxPip + 1).fill(0);
  unseen.forEach(t => {
    remainingBySuit[t[0]]++;
    if (t[1] !== t[0]) remainingBySuit[t[1]]++;
  });

  const unseenCount = unseen.length;

  /**
   * Probabilidad de que `jugadorId` tenga AL MENOS una ficha con el número `n`.
   * Hipergeométrica sobre las no vistas, con dos correcciones duras:
   *  - si pasó sobre ese número, es 0: el pase lo demuestra;
   *  - sobre mi propia mano no hay probabilidad que valga, es 0 o 1.
   */
  function pTiene(jugadorId, n) {
    if (jugadorId === botId) return miMano.some(t => t[0] === n || t[1] === n) ? 1 : 0;
    if ((passedOn[jugadorId] || []).includes(n)) return 0;
    const m = handCounts[jugadorId] || 0;
    if (m <= 0) return 0;
    const k = remainingBySuit[n] || 0;
    if (k <= 0) return 0;
    if (unseenCount <= 0) return 0;
    if (unseenCount - k < m) return 1; // no caben tantas fichas sin el número
    return 1 - combinaciones(unseenCount - k, m) / combinaciones(unseenCount, m);
  }

  const rivals = orden.filter(id =>
    id !== botId && (!game.teamsEnabled || equipos[id] !== equipos[botId])
  );
  const partners = game.teamsEnabled
    ? orden.filter(id => id !== botId && equipos[id] === equipos[botId])
    : [];

  // Quien juega justo detrás de mí. Bloquearle a él vale más que bloquear "a
  // los rivales" en bloque: es el único al que el extremo le llega intacto.
  const paso = efectos.reversed ? -1 : 1;
  const siguiente = orden.length
    ? orden[(miIndice + paso + orden.length) % orden.length]
    : null;

  // Jugadas legales. Se piden al motor (única llamada) y se enriquecen con los
  // extremos que dejaría cada una, que es sobre lo que razona todo el cerebro.
  const comodin = !!efectos.wildcardActive;
  const movimientos = (game.getValidMoves(botId) || []).map(m => {
    const tile = miMano[m.tileIndex];
    const tras = extremosTras(izq, der, tile, m.side, comodin);
    return {
      tileIndex: m.tileIndex,
      side: m.side,
      tile: [tile[0], tile[1]],
      // Extremo que crea la jugada (el que "deja expuesto") y el que tapa.
      expone: m.side === 'left' ? tras.izq : tras.der,
      tapa: izq === null ? null : (m.side === 'left' ? izq : der),
      nuevoIzq: tras.izq,
      nuevoDer: tras.der
    };
  });

  const obs = {
    // --- Hechos públicos ---
    playerId: botId,
    nivel: yo.difficulty || 'normal',
    orden,
    miIndice,
    siguiente,
    board,
    izq,
    der,
    tableroVacio: board.length === 0,
    miMano,
    miManoCount: miMano.length,
    handCounts,
    drawCounts,
    boneyardCount: game.boneyard ? game.boneyard.length : 0,
    passedOn,
    maxPip,
    totalFichas: fichasDelMazo(maxPip),
    teamsEnabled: !!game.teamsEnabled,
    miEquipo: equipos[botId],
    equipos,
    marcador,
    maxScore: game.maxScore,
    drawEnabled: game.drawEnabled !== false,
    powersEnabled: !!game.powersEnabled,
    escudos,
    poderesCount,
    esBot,
    efectos: {
      frozenEnd: efectos.frozenEnd || null,
      frozenEndOwnerId: efectos.frozenEndOwnerId || null,
      wildcardActive: comodin,
      reversed: !!efectos.reversed,
      cursedPlayerId: efectos.cursedPlayerId || null,
      cursedSide: efectos.cursedSide || null,
      skipNextTurn: !!efectos.skipNextTurn,
      doubleTurnActive: !!efectos.doubleTurnActive
    },
    // --- Derivados ---
    unseen,
    unseenCount,
    remainingBySuit,
    rivals,
    partners,
    movimientos,
    pTiene
  };

  // Congelado en profundidad: además de documentar que es una foto, evita que
  // una heurística "arregle" la observación a su gusto a mitad de decisión.
  obs.board.forEach(Object.freeze);
  obs.miMano.forEach(Object.freeze);
  obs.unseen.forEach(Object.freeze);
  obs.movimientos.forEach(m => { Object.freeze(m.tile); Object.freeze(m); });
  Object.freeze(obs.board);
  Object.freeze(obs.miMano);
  Object.freeze(obs.unseen);
  Object.freeze(obs.movimientos);
  Object.freeze(obs.remainingBySuit);
  Object.freeze(obs.orden);
  Object.freeze(obs.rivals);
  Object.freeze(obs.partners);
  Object.freeze(obs.efectos);
  return Object.freeze(obs);
}

module.exports = { buildObservation, extremosTras, encaja, combinaciones };
