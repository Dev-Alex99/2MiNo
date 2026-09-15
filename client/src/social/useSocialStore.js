import { create } from 'zustand';
import { socket } from '../socket';
import { useGameStore } from '../store/useGameStore';

/**
 * LO SOCIAL, EN UN SOLO SITIO Y CON UN SOLO SUSCRIPTOR.
 *
 * Hasta ahora `friends_data`, `profile_data` y `friend_action` los escuchaba
 * cada componente por su cuenta: FriendsModal registraba los suyos al montarse
 * y los retiraba al cerrarse, y el widget de voz hacía lo mismo con los suyos.
 * Con dos consecuencias que se notan a diario:
 *   · la lista de amigos se PERDÍA al cerrar el modal y había que volver a
 *     pedirla —y esperarla— cada vez que se abría;
 *   · nadie escuchaba nada cuando los dos estaban cerrados, así que una
 *     solicitud entrante o un amigo que se conecta no llegaban a ningún sitio.
 * Aquí los listeners se registran UNA vez y no se retiran: el estado social es
 * de la sesión, no de la pantalla que lo enseña.
 *
 * ─── POR QUÉ `iniciarSocial()` Y NO UN `socket.on` AL IMPORTAR ───
 * El banco de pruebas llama a `__socket.reset()` en cada `afterEach` y eso
 * vacía el mapa de handlers. Un registro en ámbito de módulo sobreviviría UN
 * test por archivo y después ninguno, en verde y en silencio (contrato §10).
 * `iniciarSocial()` es idempotente y comprueba el registro CONTRA EL SOCKET, no
 * contra una bandera de módulo, así que vuelve a cablearse solo después de un
 * reset. Lo llama cualquier pantalla social al montarse.
 *
 * ─── LO QUE ESTE STORE NO HACE ───
 * No escribe en useGameStore. Las `capacidades` las LEE (§6 del contrato): son
 * del servidor y las reconcilia `session`. `hayPersistencia()` y `hayAmigos()`
 * son la única puerta, para que las cuatro pantallas sociales digan lo mismo
 * del mismo dato en lugar de inventarse cada una su valor por defecto.
 */

// Lo que se tarda en admitir que los datos no van a llegar. El servidor puede
// aceptar el `get_profile` y no contestar nunca (roomHandler aborta en silencio
// cuando la identidad no quedó vinculada), así que sin este vigilante el
// spinner gira para siempre: no hay evento de error que apagarlo.
export const ESPERA_MAXIMA_MS = 6000;

const VACIO = {
  amigos: [],
  solicitudes: [],
  miCodigo: '',
  disponibilidad: 'libre',
  // El perfil crudo tal y como lo manda el servidor, o null. `null` NO es
  // «cero monedas»: es «no lo sabemos», y las dos pantallas que lo pintan
  // tienen que decir cosas distintas en cada caso.
  perfil: null,
  // 'cargando' | 'listo' | 'sinDatos'. El tercero es el vigilante vencido.
  estado: 'cargando',
  // El último aviso de `friend_action`, ya como clave i18n: { clave, tipo }.
  aviso: null
};

export const useSocialStore = create((set, get) => ({
  ...VACIO,

  setDisponibilidad: (modo) => {
    set({ disponibilidad: modo });
    socket.emit('set_availability', { modo });
  },

  // Para el aviso efímero de «Solicitud enviada» / «Código no encontrado».
  limpiarAviso: () => set({ aviso: null }),

  // Vuelve a pedirlo todo. Es el [Reintentar] de las cuatro pantallas y la
  // única forma de salir de 'sinDatos'.
  recargar: () => {
    const { cuentaId, name } = useGameStore.getState();
    set({ estado: 'cargando' });
    socket.emit('get_friends', { playerId: cuentaId });
    socket.emit('get_profile', { playerId: cuentaId, username: name || 'Jugador' });
    armarVigilante(set, get);
  },

  // Sólo para las pruebas y para el cierre de sesión: deja el store como nació.
  reiniciarSocial: () => {
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    set({ ...VACIO });
  }
}));

let temporizador = null;

function armarVigilante(set, get) {
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    // Si algo llegó mientras tanto, el estado ya es 'listo' y no se toca: el
    // vigilante sólo tiene voz cuando NADIE ha contestado.
    if (get().estado === 'cargando') set({ estado: 'sinDatos' });
  }, ESPERA_MAXIMA_MS);
}

function llegaronDatos(set) {
  if (temporizador) { clearTimeout(temporizador); temporizador = null; }
  set({ estado: 'listo' });
}

function alRecibirAmigos(data) {
  const set = useSocialStore.setState;
  llegaronDatos(set);
  if (!data) return;
  set({
    amigos: Array.isArray(data.friends) ? data.friends : [],
    solicitudes: Array.isArray(data.requests) ? data.requests : []
  });
}

function alRecibirPerfil(data) {
  const set = useSocialStore.setState;
  llegaronDatos(set);
  // `profile_data: null` es un evento REAL: el servidor lo emite cuando no hay
  // persistencia. Deja el perfil en null a propósito, que es lo que distingue
  // «no hay datos» de «tienes cero monedas».
  if (!data) { set({ perfil: null }); return; }
  set({
    perfil: data,
    miCodigo: data.friend_code || useSocialStore.getState().miCodigo
  });
}

function alRecibirPresencia(p) {
  if (!p || !p.id) return;
  // Diferencial: el servidor manda sólo a quien cambia. Si no está en la lista
  // no se inventa una fila; llegará con el próximo `friends_data`.
  useSocialStore.setState((s) => ({
    amigos: s.amigos.map((a) => (
      a.id === p.id ? { ...a, online: !!p.online, actividad: p.actividad || null } : a
    ))
  }));
}

function alResponderAccion(res) {
  if (!res) return;
  if (res.success) {
    useSocialStore.setState({
      aviso: { clave: res.accepted ? 'friend.accepted' : 'friend.sent', tipo: 'ok' }
    });
    // La lista cambia con cada alta o baja y el servidor no siempre la reemite.
    socket.emit('get_friends', { playerId: useGameStore.getState().cuentaId });
  } else {
    useSocialStore.setState({ aviso: { clave: res.error || 'friend.err.generic', tipo: 'err' } });
  }
}

const CABLEADO = [
  ['friends_data', alRecibirAmigos],
  ['profile_data', alRecibirPerfil],
  ['friend_presence', alRecibirPresencia],
  ['friend_action', alResponderAccion]
];

/**
 * Registra los cuatro listeners y pide los datos si todavía no hay ninguno.
 * Idempotente: llamarlo cinco veces deja un solo suscriptor por evento.
 */
export function iniciarSocial() {
  let yaEstaba = false;
  try {
    yaEstaba = socket.listeners('friends_data').includes(alRecibirAmigos);
  } catch {
    // Un socket sin `listeners()` (o un doble incompleto): se re-registra y
    // socket.io descarta el duplicado exacto por sí solo.
  }
  if (!yaEstaba) {
    for (const [evento, handler] of CABLEADO) socket.on(evento, handler);
  }
  // Se vuelve a pedir mientras el servidor no haya contestado NI UNA vez.
  // Reabrir el modal con los datos ya en memoria no devuelve la lista al
  // spinner; reabrirlo tras un vigilante vencido sí reintenta, que es lo que
  // espera quien cierra y vuelve a abrir para ver si ahora va.
  if (useSocialStore.getState().estado !== 'listo') useSocialStore.getState().recargar();
}

/**
 * LA MISMA BANDERA PARA LAS CUATRO PANTALLAS SOCIALES. Se lee de `capacidades`,
 * nunca se adivina: hasta ahora el perfil afirmaba 500 monedas mientras la
 * tienda afirmaba 0 sobre el mismo monedero vacío, porque cada uno se inventó
 * su valor por defecto.
 *
 * Hay dos formas porque hay dos usos: la de hook para pintar (se re-renderiza
 * cuando llega `session`) y la de función para los manejadores, que necesitan
 * el valor del momento en que se pulsa.
 */
export function useCapacidades() {
  return useGameStore((s) => s.capacidades);
}

/** Este servidor guarda progreso (monedas, ELO, tienda, ranking). */
export function hayPersistencia(cap) {
  return (cap || useGameStore.getState().capacidades)?.persistencia !== false;
}

/** Este servidor guarda la lista de amigos. */
export function hayAmigos(caps) {
  const cap = caps || useGameStore.getState().capacidades;
  return cap?.persistencia !== false && cap?.amigos !== false;
}
