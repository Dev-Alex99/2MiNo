/**
 * Doble de `socket.io-client` para los tests: no abre conexión, registra lo que
 * la app emite y permite disparar eventos entrantes a mano.
 *
 * Se usa a través del mock global de `src/socket` (ver `setup.js`), así que
 * cualquier componente o hook que importe `{ socket }` recibe éste.
 */
export function createFakeSocket() {
  const handlers = new Map();
  let emitted = [];

  return {
    connected: false,

    // ─── API que consume la app ───
    on(evento, fn) {
      if (!handlers.has(evento)) handlers.set(evento, new Set());
      handlers.get(evento).add(fn);
    },
    off(evento, fn) {
      const set = handlers.get(evento);
      if (set) set.delete(fn);
    },
    once(evento, fn) {
      const envoltorio = (payload) => { this.off(evento, envoltorio); fn(payload); };
      this.on(evento, envoltorio);
    },
    emit(evento, payload) {
      emitted.push({ evento, payload });
    },
    connect() { this.connected = true; },
    disconnect() { this.connected = false; },

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
    /** Cuántos listeners hay registrados para un evento (detecta fugas). */
    listeners(evento) {
      return handlers.get(evento) ? handlers.get(evento).size : 0;
    },
    /** Nombres de todos los eventos con al menos un listener. */
    eventosEscuchados() {
      return [...handlers.entries()].filter(([, s]) => s.size > 0).map(([e]) => e).sort();
    },
    reset() {
      handlers.clear();
      emitted = [];
      this.connected = false;
    }
  };
}
