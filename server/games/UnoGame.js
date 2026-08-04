const BaseGame = require('../core/BaseGame');

/**
 * Uno — juego de cartas para 2-4 jugadores del hub multijuego.
 *
 * Encaja en la arquitectura existente sin inventar nada nuevo: reutiliza el
 * modelo de MANO OCULTA del dominó (el servidor filtra las manos en
 * `getGameStateForPlayer`), el ciclo de rondas (`round_ended` → `startNewRound`)
 * y el contrato de bots (`playBotTurn`, que el orquestador programa y difunde).
 *
 * ─── Decisiones de reglas ───
 * Hay variantes caseras para todo; éstas son las elegidas, y se explican donde
 * podrían sorprender:
 *  · Robar: si no puedes jugar, robas UNA carta. Si esa carta es jugable puedes
 *    jugarla en el mismo turno; si no, el turno pasa. (No se roba hasta poder).
 *  · Cantar UNO: se declara AL JUGAR la penúltima carta. Si no se declara, son
 *    +2 automáticas. La regla clásica exige que otro jugador te pille, lo que
 *    con bots y desconexiones es una fuente de discusiones; así es determinista.
 *  · +4: se puede jugar siempre (no se comprueba si tenías color válido). La
 *    variante con "desafío" duplica el estado y las reglas por poco.
 *  · Si la carta inicial del descarte es un comodín, se devuelve al mazo y se
 *    saca otra: así nadie empieza eligiendo color sin haber jugado.
 */

const COLORES = ['rojo', 'amarillo', 'verde', 'azul'];
// Cartas de acción con color. `mas2` roba 2 y salta; `salta` salta; `cambio`
// invierte el sentido (con 2 jugadores actúa como salta, como en el juego real).
const ACCIONES = ['salta', 'cambio', 'mas2'];
// Comodines (sin color hasta que se juegan).
const COMODINES = ['comodin', 'comodin_mas4'];

const PUNTOS = { numero: null, salta: 20, cambio: 20, mas2: 20, comodin: 50, comodin_mas4: 50 };

class UnoGame extends BaseGame {
  constructor(roomId, options = {}) {
    super('uno', roomId, options);
    this.minPlayers = 2;
    this.maxPlayers = 4;

    // Puntos a los que se acaba la partida. El Uno clásico juega a 500; aquí se
    // baja por defecto para que una partida no eternice la mesa.
    this.maxScore = [200, 300, 500].includes(options.maxScore) ? options.maxScore : 200;

    this.deck = [];
    this.discard = [];        // el último elemento es la carta visible
    this.currentColor = null; // color en juego (un comodín lo cambia)
    this.currentPlayerIdx = 0;
    this.direction = 1;       // 1 horario, -1 antihorario
    this.pendingDraw = 0;     // acumulado de +2/+4 que debe robar el siguiente
    this.hasDrawnThisTurn = false; // ya robó: sólo puede jugar esa carta o pasar
    this.roundWinnerId = null;
    this.gameWinner = null;
    this.lastAction = null;   // para narrar en el cliente
  }

  // ─── Mazo ───

  /** Baraja de 108 cartas: 25 por color (0, dos de 1-9, dos de cada acción) + 8 comodines. */
  static crearMazo() {
    const mazo = [];
    for (const color of COLORES) {
      mazo.push({ color, tipo: 'numero', valor: 0 });
      for (let v = 1; v <= 9; v++) {
        mazo.push({ color, tipo: 'numero', valor: v });
        mazo.push({ color, tipo: 'numero', valor: v });
      }
      for (const tipo of ACCIONES) {
        mazo.push({ color, tipo, valor: null });
        mazo.push({ color, tipo, valor: null });
      }
    }
    for (const tipo of COMODINES) {
      for (let i = 0; i < 4; i++) mazo.push({ color: null, tipo, valor: null });
    }
    return mazo;
  }

  static puntosDe(carta) {
    if (!carta) return 0;
    if (carta.tipo === 'numero') return carta.valor || 0;
    return PUNTOS[carta.tipo] || 0;
  }

  barajar(cartas) {
    for (let i = cartas.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cartas[i], cartas[j]] = [cartas[j], cartas[i]];
    }
    return cartas;
  }

  /**
   * Saca una carta del mazo. Si se agota, se recicla el descarte (dejando la
   * carta visible) y se baraja. Devuelve null sólo si no queda ninguna en
   * ningún sitio, que con 108 cartas y 4 manos no debería pasar, pero el
   * llamador no puede asumirlo.
   */
  robarDelMazo() {
    if (!this.deck.length) {
      if (this.discard.length <= 1) return null;
      const visible = this.discard.pop();
      // Los comodines vuelven al mazo sin color: si no, el color elegido en su
      // día viajaría con la carta y volvería a salir "pintada".
      this.deck = this.barajar(this.discard.map(c => (
        COMODINES.includes(c.tipo) ? { ...c, color: null } : c
      )));
      this.discard = [visible];
    }
    return this.deck.pop() || null;
  }

  // ─── Ciclo de la partida ───

  startNewGame() {
    if (this.players.length < this.minPlayers) return false;
    this.players.forEach(p => { p.score = 0; });
    this.gameWinner = null;
    this.roundNumber = 0;
    return this.startNewRound();
  }

  startNewRound() {
    if (this.players.length < this.minPlayers) return false;

    this.deck = this.barajar(UnoGame.crearMazo());
    this.discard = [];
    this.direction = 1;
    this.pendingDraw = 0;
    this.hasDrawnThisTurn = false;
    this.roundWinnerId = null;
    this.lastAction = null;
    this.roundNumber += 1;
    this.status = 'playing';

    for (const p of this.players) {
      p.hand = [];
      p.declaredUno = false;
      for (let i = 0; i < 7; i++) {
        const c = this.robarDelMazo();
        if (c) p.hand.push(c);
      }
    }

    // Carta inicial: si sale comodín se devuelve al mazo y se prueba otra, para
    // que nadie empiece eligiendo color sin haber jugado.
    let inicial = this.robarDelMazo();
    let intentos = 0;
    while (inicial && COMODINES.includes(inicial.tipo) && intentos++ < 20) {
      this.deck.unshift(inicial);
      inicial = this.robarDelMazo();
    }
    if (!inicial) return false;
    this.discard = [inicial];
    this.currentColor = inicial.color;

    // Quien abre alterna por ronda, como en el resto de juegos del hub.
    this.currentPlayerIdx = (this.roundNumber - 1) % this.players.length;

    // Efecto de la carta inicial (regla estándar): salta o invierte antes de
    // que nadie juegue. El +2 inicial deja la deuda al primero.
    if (inicial.tipo === 'salta') this.avanzarTurno();
    else if (inicial.tipo === 'cambio') {
      this.direction = -1;
      if (this.players.length > 2) this.avanzarTurno();
    } else if (inicial.tipo === 'mas2') this.pendingDraw = 2;

    this.resetTurnTimer();
    return true;
  }

  resetTurnTimer() {
    this.turnEndsAt = Date.now() + (this.turnDurationMs || 30000);
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIdx] || null;
  }

  avanzarTurno(saltos = 1) {
    const n = this.players.length;
    if (!n) return;
    this.currentPlayerIdx = (((this.currentPlayerIdx + this.direction * saltos) % n) + n) % n;
    this.hasDrawnThisTurn = false;
  }

  cartaVisible() {
    return this.discard[this.discard.length - 1] || null;
  }

  // ─── Legalidad ───

  /**
   * ¿Se puede jugar esa carta ahora?
   *
   * Con una deuda de +2/+4 pendiente sólo vale encadenar otro +2 (o +4 sobre
   * +4): si no, el jugador de turno tiene que robar lo acumulado.
   */
  esJugable(carta, { color = this.currentColor, visible = this.cartaVisible(), pendingDraw = this.pendingDraw } = {}) {
    if (!carta) return false;

    if (pendingDraw > 0) {
      if (visible && visible.tipo === 'comodin_mas4') return carta.tipo === 'comodin_mas4';
      return carta.tipo === 'mas2' || carta.tipo === 'comodin_mas4';
    }

    if (COMODINES.includes(carta.tipo)) return true;
    if (carta.color === color) return true;
    if (!visible) return false;
    if (carta.tipo === 'numero' && visible.tipo === 'numero') return carta.valor === visible.valor;
    return carta.tipo === visible.tipo && carta.tipo !== 'numero';
  }

  jugablesDe(playerId) {
    const p = this.players.find(x => x.id === playerId);
    if (!p || !Array.isArray(p.hand)) return [];
    return p.hand
      .map((carta, indice) => ({ carta, indice }))
      .filter(({ carta }) => this.esJugable(carta));
  }

  // ─── Acciones ───

  handleAction(playerId, actionType, payload = {}) {
    if (this.status !== 'playing') return { success: false, error: 'srv.err.gameNotRunning' };

    const actual = this.getCurrentPlayer();
    if (!actual || actual.id !== playerId) return { success: false, error: 'srv.err.notYourTurn' };

    switch (actionType) {
      case 'play': return this.jugarCarta(actual, payload);
      case 'draw': return this.robar(actual);
      case 'pass': return this.pasar(actual);
      default: return { success: false, error: 'srv.err.unknownAction' };
    }
  }

  jugarCarta(jugador, { index, color, uno }) {
    if (typeof index !== 'number' || index < 0 || index >= jugador.hand.length) {
      return { success: false, error: 'srv.err.badCard' };
    }
    const carta = jugador.hand[index];
    if (!this.esJugable(carta)) {
      return { success: false, error: this.pendingDraw > 0 ? 'srv.err.mustStack' : 'srv.err.cardNotPlayable' };
    }
    if (COMODINES.includes(carta.tipo) && !COLORES.includes(color)) {
      return { success: false, error: 'srv.err.pickColor' };
    }

    jugador.hand.splice(index, 1);
    this.discard.push(carta);
    this.currentColor = COMODINES.includes(carta.tipo) ? color : carta.color;
    this.hasDrawnThisTurn = false;
    this.lastAction = { playerId: jugador.id, tipo: 'jugar', carta, color: this.currentColor };

    // Cantar UNO: se declara al jugar la penúltima. Sin declararlo son +2.
    let penalizado = false;
    if (jugador.hand.length === 1) {
      jugador.declaredUno = uno === true;
      if (!jugador.declaredUno) {
        for (let i = 0; i < 2; i++) {
          const c = this.robarDelMazo();
          if (c) jugador.hand.push(c);
        }
        penalizado = true;
        this.lastAction = { ...this.lastAction, penalizadoPorNoCantar: true };
      }
    } else {
      jugador.declaredUno = false;
    }

    // ¿Ronda ganada?
    if (jugador.hand.length === 0) {
      this.terminarRonda(jugador);
      return { success: true, roundEnded: true, penalizado };
    }

    this.aplicarEfecto(carta);
    this.resetTurnTimer();
    return { success: true, penalizado };
  }

  /** Efecto de la carta recién jugada sobre el turno y la deuda de robo. */
  aplicarEfecto(carta) {
    switch (carta.tipo) {
      case 'salta':
        this.avanzarTurno(2);
        break;
      case 'cambio':
        this.direction *= -1;
        // Con dos jugadores, invertir el sentido equivale a saltar el turno del
        // rival, que es como funciona en el juego real.
        this.avanzarTurno(this.players.length === 2 ? 2 : 1);
        break;
      case 'mas2':
        this.pendingDraw += 2;
        this.avanzarTurno();
        break;
      case 'comodin_mas4':
        this.pendingDraw += 4;
        this.avanzarTurno();
        break;
      default:
        this.avanzarTurno();
    }
  }

  robar(jugador) {
    // Con deuda pendiente, robar significa tragarse todo lo acumulado y perder
    // el turno: es la única salida si no puedes encadenar.
    if (this.pendingDraw > 0) {
      const total = this.pendingDraw;
      for (let i = 0; i < total; i++) {
        const c = this.robarDelMazo();
        if (c) jugador.hand.push(c);
      }
      this.pendingDraw = 0;
      this.lastAction = { playerId: jugador.id, tipo: 'robar_castigo', n: total };
      this.avanzarTurno();
      this.resetTurnTimer();
      return { success: true, drew: total };
    }

    if (this.hasDrawnThisTurn) return { success: false, error: 'srv.err.alreadyDrew' };

    const carta = this.robarDelMazo();
    if (!carta) {
      // Sin cartas en ningún sitio: pasar es lo único posible.
      this.lastAction = { playerId: jugador.id, tipo: 'pasar' };
      this.avanzarTurno();
      this.resetTurnTimer();
      return { success: true, drew: 0 };
    }

    jugador.hand.push(carta);
    jugador.declaredUno = false;
    this.hasDrawnThisTurn = true;
    this.lastAction = { playerId: jugador.id, tipo: 'robar', n: 1 };

    // Si la robada no sirve, el turno pasa solo: no tiene sentido obligar a
    // pulsar "pasar" cuando no hay ninguna decisión que tomar.
    if (!this.esJugable(carta)) {
      this.avanzarTurno();
      this.resetTurnTimer();
      return { success: true, drew: 1, turnPassed: true };
    }

    this.resetTurnTimer();
    return { success: true, drew: 1, canPlayDrawn: true };
  }

  /** Sólo tiene sentido tras robar una carta jugable y no querer jugarla. */
  pasar(jugador) {
    if (!this.hasDrawnThisTurn) return { success: false, error: 'srv.err.mustDrawFirst' };
    this.lastAction = { playerId: jugador.id, tipo: 'pasar' };
    this.avanzarTurno();
    this.resetTurnTimer();
    return { success: true };
  }

  // ─── Fin de ronda y de partida ───

  /** Quien se queda sin cartas suma el valor de las manos de los demás. */
  terminarRonda(ganador) {
    let puntos = 0;
    for (const p of this.players) {
      if (p.id === ganador.id) continue;
      for (const carta of p.hand || []) puntos += UnoGame.puntosDe(carta);
    }
    ganador.score += puntos;
    this.roundWinnerId = ganador.id;
    this.lastAction = { playerId: ganador.id, tipo: 'ronda_ganada', puntos };

    if (ganador.score >= this.maxScore) {
      this.gameWinner = ganador.id;
      this.status = 'game_ended';
    } else {
      this.status = 'round_ended';
    }
    this.turnEndsAt = null;
  }

  getWinnerId() {
    return this.gameWinner || null;
  }

  getVariantLabel() {
    return `uno_${this.maxScore}`;
  }

  // ─── Turno forzado por el reloj ───

  forceTurn() {
    const nada = { action: 'none', playerId: null, playerName: null, drew: 0 };
    if (this.status !== 'playing') return nada;
    const actual = this.getCurrentPlayer();
    if (!actual) return nada;

    const jugada = this.elegirJugada(actual, 'normal');
    if (jugada) {
      const res = this.jugarCarta(actual, jugada);
      if (res.success) return { action: 'played', playerId: actual.id, playerName: actual.name, drew: 0 };
    }

    const res = this.robar(actual);
    return {
      action: res.success ? 'passed' : 'none',
      playerId: actual.id,
      playerName: actual.name,
      drew: res.drew || 0
    };
  }

  // ─── Bots ───

  handlesOwnBots() {
    return false;
  }

  addBot(name = 'Bot Uno', difficulty = 'normal') {
    if (this.players.length >= this.maxPlayers) return null;
    const bot = {
      id: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: name || 'Bot Uno',
      isBot: true,
      difficulty,
      ready: true,
      score: 0,
      hand: [],
      declaredUno: false
    };
    this.players.push(bot);
    this.ensureHost();
    return bot;
  }

  playBotTurn(botId) {
    const bot = this.players.find(p => p.id === botId);
    if (!bot || this.status !== 'playing') return { action: 'none' };

    const jugada = this.elegirJugada(bot, bot.difficulty);
    if (jugada) {
      const res = this.jugarCarta(bot, jugada);
      if (res.success) return { action: 'played', carta: this.cartaVisible() };
    }

    const res = this.robar(bot);
    if (!res.success) return { action: 'none' };

    // Si la robada es jugable, el bot la juega en el mismo turno.
    if (res.canPlayDrawn) {
      const segunda = this.elegirJugada(bot, bot.difficulty);
      if (segunda) {
        const r2 = this.jugarCarta(bot, segunda);
        if (r2.success) return { action: 'played', carta: this.cartaVisible() };
      }
      this.pasar(bot);
    }
    return { action: 'passed', drew: res.drew || 0 };
  }

  /**
   * Decide qué jugar, o null si no puede. Devuelve el payload de `jugarCarta`
   * ya montado (índice, color del comodín y si canta UNO).
   *
   * Niveles: fácil juega la primera legal; normal prioriza deshacerse de cartas
   * altas y guarda comodines; difícil/maestro además ataca al rival que va
   * ganando y elige el color que más le conviene.
   */
  elegirJugada(jugador, difficulty = 'normal') {
    const opciones = this.jugablesDe(jugador.id);
    if (!opciones.length) return null;

    const cantarUno = jugador.hand.length === 2; // al jugar quedará con una
    const conColor = (elegida) => ({
      index: elegida.indice,
      color: COMODINES.includes(elegida.carta.tipo)
        ? this.mejorColor(jugador, difficulty)
        : undefined,
      uno: cantarUno
    });

    if (difficulty === 'facil') return conColor(opciones[0]);

    const esComodin = (o) => COMODINES.includes(o.carta.tipo);
    const rivalCerca = this.players.some(p => p.id !== jugador.id && (p.hand || []).length <= 2);

    // Difícil/maestro: si alguien está a punto de cantar, se le castiga con lo
    // que haga más daño antes de gastar nada más.
    if (difficulty !== 'normal' && rivalCerca) {
      const ataque = opciones.find(o => o.carta.tipo === 'comodin_mas4')
        || opciones.find(o => o.carta.tipo === 'mas2')
        || opciones.find(o => o.carta.tipo === 'salta');
      if (ataque) return conColor(ataque);
    }

    // Guardar los comodines para cuando no haya otra cosa.
    const sinComodin = opciones.filter(o => !esComodin(o));
    const candidatas = sinComodin.length ? sinComodin : opciones;

    // Entre las demás, soltar la de más puntos: al final de ronda restan.
    candidatas.sort((a, b) => UnoGame.puntosDe(b.carta) - UnoGame.puntosDe(a.carta));
    return conColor(candidatas[0]);
  }

  /** Color al que cambiar con un comodín: el que más tiene en la mano. */
  mejorColor(jugador, difficulty = 'normal') {
    const cuenta = Object.fromEntries(COLORES.map(c => [c, 0]));
    for (const carta of jugador.hand || []) {
      if (carta.color && cuenta[carta.color] !== undefined) cuenta[carta.color]++;
    }
    let mejor = COLORES[0];
    for (const c of COLORES) if (cuenta[c] > cuenta[mejor]) mejor = c;
    // En fácil, si no tiene ninguno de color, elige al azar en vez de siempre rojo.
    if (difficulty === 'facil' && cuenta[mejor] === 0) {
      return COLORES[Math.floor(Math.random() * COLORES.length)];
    }
    return mejor;
  }

  // ─── Estado ───

  getSharedState() {
    return {
      gameType: this.gameType,
      roomId: this.roomId,
      status: this.status,
      maxPlayers: this.maxPlayers,
      hostId: this.hostId,
      roundNumber: this.roundNumber,
      maxScore: this.maxScore,
      currentPlayerId: this.getCurrentPlayer() ? this.getCurrentPlayer().id : null,
      turnEndsAt: this.turnEndsAt,
      turnSecondsRemaining: this.turnEndsAt ? Math.max(0, Math.ceil((this.turnEndsAt - Date.now()) / 1000)) : 0,
      topCard: this.cartaVisible(),
      currentColor: this.currentColor,
      direction: this.direction,
      pendingDraw: this.pendingDraw,
      deckCount: this.deck.length,
      roundWinnerId: this.roundWinnerId,
      gameWinner: this.gameWinner,
      lastAction: this.lastAction,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        isBot: !!p.isBot,
        difficulty: p.isBot ? p.difficulty : undefined,
        ready: p.ready,
        score: p.score,
        handCount: (p.hand || []).length,
        declaredUno: !!p.declaredUno
      }))
    };
  }

  /**
   * Igual que el dominó: sólo el destinatario ve su mano. Al acabar la ronda se
   * destapan todas para poder contar los puntos.
   */
  getGameStateForPlayer(playerId, sharedState) {
    const shared = sharedState || this.getSharedState();
    const destapado = this.status === 'round_ended' || this.status === 'game_ended';
    return {
      ...shared,
      // Sólo lo propio: qué cartas puede jugar ahora mismo, para que el cliente
      // las resalte sin duplicar las reglas.
      playableIndices: this.getCurrentPlayer() && this.getCurrentPlayer().id === playerId
        ? this.jugablesDe(playerId).map(o => o.indice)
        : [],
      players: shared.players.map(p => {
        const real = this.players.find(x => x.id === p.id);
        return {
          ...p,
          hand: (p.id === playerId || destapado) ? (real ? real.hand : []) : []
        };
      })
    };
  }

  getSpectatorState(sharedState) {
    const shared = sharedState || this.getSharedState();
    return {
      ...shared,
      isSpectator: true,
      playableIndices: [],
      players: shared.players.map(p => ({ ...p, hand: [] }))
    };
  }
}

UnoGame.COLORES = COLORES;
UnoGame.ACCIONES = ACCIONES;
UnoGame.COMODINES = COMODINES;

const GameRegistry = require('../core/GameRegistry');
GameRegistry.register('uno', UnoGame, {
  name: 'Uno',
  minPlayers: 2,
  maxPlayers: 4,
  description: 'Cartas rápidas: encadena color o número, y no olvides cantar ¡UNO!'
});

module.exports = UnoGame;
