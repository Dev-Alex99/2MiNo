/**
 * Doble de `socket.io-client` para los tests: no abre conexión, registra lo que
 * la app emite y permite disparar eventos entrantes a mano.
 *
 * Se usa a través del mock global de `src/socket` (ver `setup.js`), así que
 * cualquier componente o hook que importe `{ socket }` recibe éste.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * AVISO QUE VALE POR UNA TARDE DE DEPURACIÓN
 *
 * `setup.js` llama a `reset()` en cada `afterEach` y `reset()` VACÍA el mapa de
 * handlers. De ahí una regla que no es negociable: NINGÚN módulo registra sus
 * `socket.on()` en ámbito de módulo. Un módulo se importa UNA vez por fichero de
 * test, así que esos listeners sobreviven al primer caso y desaparecen para
 * siempre en el segundo — y los demás pasan en verde sin escuchar nada, sin un
 * error y sin que ningún assert cambie de color. Los listeners van dentro de un
 * `iniciar()` idempotente (o de un efecto de React) que se pueda volver a
 * llamar. Si un test necesita de verdad conservarlos entre casos:
 * `reset({ conservarHandlers: true })`.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * DOS PESTAÑAS DE LA MISMA CUENTA. La app sólo conoce un socket (el singleton de
 * `globalThis.__socket`), así que la pestaña hermana no se monta: se representa
 * por lo que el servidor le manda a ÉSTA cuando la otra actúa —
 * `simularTimbreAtendidoEnOtraPestana()` y `simularRelevoDeOtraPestana()`. Para
 * un test que sí quiera dos sockets de verdad (uno contra un servidor de
 * mentira, por ejemplo), `createFakeSocket({ prefijo: 'sk_b' })` da una segunda
 * instancia con ids que no se confunden con los de la primera.
 */
export function createFakeSocket({ prefijo = 'sk' } = {}) {
  const handlers = new Map();
  let emitted = [];
  let contadorId = 0;

  const nuevoId = () => `${prefijo}_${++contadorId}`;

  return {
    connected: false,
    // `socket.id` cambia en cada reconexión, y ese cambio es justo el escenario
    // que el reenganche de voz tiene que sobrevivir: el servidor liga la sesión
    // de voz al id de la pestaña, no a la cuenta.
    id: nuevoId(),
    /** Cuántas veces ha pasado por el ciclo desconectar→conectar. */
    reconexiones: 0,

    // ─── API que consume la app ───
    on(evento, fn) {
      if (!handlers.has(evento)) handlers.set(evento, new Set());
      handlers.get(evento).add(fn);
      return this;
    },
    off(evento, fn) {
      const set = handlers.get(evento);
      if (set) set.delete(fn);
      return this;
    },
    once(evento, fn) {
      const envoltorio = (payload) => { this.off(evento, envoltorio); fn(payload); };
      this.on(evento, envoltorio);
      return this;
    },
    emit(evento, payload, ...resto) {
      emitted.push({ evento, payload, resto });
      return this;
    },
    // `connect()` y `disconnect()` sólo mueven la bandera, como hasta ahora: NO
    // disparan los eventos 'connect'/'disconnect'. Para eso están las ayudas de
    // abajo, que además son las únicas que renuevan el `id`.
    connect() { this.connected = true; return this; },
    disconnect() { this.connected = false; return this; },

    // ─── Ayudas para los tests ───
    /** Simula un evento que llega del servidor. */
    recibir(evento, payload) {
      const set = handlers.get(evento);
      if (set) for (const fn of [...set]) fn(payload);
    },
    /** Todo lo emitido, o sólo lo de un evento concreto. */
    emitidos(evento) {
      return evento ? emitted.filter(e => e.evento === evento) : emitted;
    },
    /** Payload del último `emit` de ese evento (undefined si no hubo). */
    ultimoEmitido(evento) {
      const lista = this.emitidos(evento);
      return lista.length ? lista[lista.length - 1].payload : undefined;
    },
    /** Vacía el registro de emitidos sin tocar los listeners ni la conexión. */
    limpiarEmitidos() {
      emitted = [];
    },
    /** Cuántos listeners hay registrados para un evento (detecta fugas). */
    listeners(evento) {
      return handlers.get(evento) ? handlers.get(evento).size : 0;
    },
    /** Nombres de todos los eventos con al menos un listener. */
    eventosEscuchados() {
      return [...handlers.entries()].filter(([, s]) => s.size > 0).map(([e]) => e).sort();
    },

    /**
     * Se cae la conexión. El motivo viaja como primer argumento de 'disconnect',
     * igual que en socket.io.
     */
    simularDesconexion(motivo = 'transport close') {
      this.connected = false;
      this.recibir('disconnect', motivo);
      return motivo;
    },

    /** Vuelve la conexión con el id que haya en ese momento. */
    simularConexion() {
      this.connected = true;
      this.recibir('connect');
      return this.id;
    },

    /**
     * El ciclo completo de una reconexión de móvil: se cae, el socket cambia de
     * id y vuelve. Es el escenario que hoy no se podía montar y del que depende
     * todo el reenganche de voz (los pares WebRTC no mueren porque muera el
     * socket de señalización; lo que muere es la dirección a la que el servidor
     * les hablaba). Devuelve el id NUEVO.
     */
    simularReconexion({ motivo = 'transport close', cambiarId = true } = {}) {
      this.simularDesconexion(motivo);
      if (cambiarId) this.id = nuevoId();
      this.reconexiones += 1;
      return this.simularConexion();
    },

    /**
     * La cuenta contestó el timbre en OTRA pestaña: a ésta le llega la
     * cancelación con su motivo, no un silencio.
     */
    simularTimbreAtendidoEnOtraPestana(callId = null) {
      this.recibir('call_cancelled', { callId, motivo: 'atendida_en_otra_pestana' });
    },

    /**
     * Otra pestaña de la misma cuenta se llevó la sesión de voz (una sola sesión
     * por cuenta): a ésta la relevan y tiene que desmontar en local.
     */
    simularRelevoDeOtraPestana(callId = null) {
      this.recibir('voice_taken', { callId });
    },

    /**
     * Vuelta al estado inicial. Con `conservarHandlers` se mantienen los
     * listeners registrados (y el id, y el contador de reconexiones): sirve para
     * un test que quiera reiniciar el tráfico sin volver a montar el árbol.
     */
    reset({ conservarHandlers = false } = {}) {
      if (!conservarHandlers) {
        handlers.clear();
        contadorId = 0;
        this.id = nuevoId();
        this.reconexiones = 0;
      }
      emitted = [];
      this.connected = false;
    }
  };
}
