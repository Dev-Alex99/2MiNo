import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Phone, PhoneIncoming, Swords, Eye, UserPlus } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { useGameStore } from '../store/useGameStore';
import { useSocialStore } from '../social/useSocialStore';
import { useVoice } from '../voice/VoiceContext';
import { colorDeJugador } from '../utils/colorDeJugador';

/**
 * El carril de gente: quién está y qué cuesta llamarle AHORA.
 *
 * Hasta ahora la única puerta para llamar a alguien era `FriendsModal`, que ni
 * siquiera se montaba fuera del hub y del lobby. La gente estaba escondida
 * detrás de dos clics en una pantalla que no contaba que existiera.
 *
 * SEMÁNTICA: `<ul>` / `<li>` con `<button>` de verdad y roving tabindex. NO
 * `role="listbox"`: una opción de listbox es un valor que se selecciona, y esto
 * es un botón que abre acciones. Es el mismo patrón de teclado que la mano del
 * dominó: ←/→ para moverse, Inicio/Fin a los extremos, Enter/Espacio abre.
 *
 * ETIQUETA: el nombre accesible del botón dice el coste de llamar ahora
 * («Llamar a Marta», «Llamar a Luis · está jugando», «Pedir entrar a la llamada
 * de Marta», «Marta no quiere que la llamen ahora»). Esa información no puede
 * vivir sólo en el color: ningún estado de persona usa rojo —el rojo es del
 * reloj crítico y de colgar— y cada uno lleva además su glifo.
 */

// Orden del carril: quien está en una llamada primero (es a quien puedes
// pedirle entrar), luego quien está libre, y al final quien está ocupado. Los
// desconectados NO salen: un carril de grises no es una lista de gente, y su
// sitio es la hoja completa de la línea.
const ORDEN = { en_llamada: 0, libre: 1, en_sala: 2, jugando: 3, no_molestar: 4 };

// Glifo por estado. Va SIEMPRE con el punto de color y con el texto: el punto
// solo no lo lee un daltónico y no lo lee nadie en una captura en blanco y negro.
const GLIFO = {
  libre: '●',
  en_sala: '▣',
  jugando: '▶',
  en_llamada: '◑',
  no_molestar: '⊘'
};

const CLAVE_ESTADO = {
  libre: 'pres.libre',
  en_sala: 'pres.enSala',
  jugando: 'pres.jugando',
  en_llamada: 'pres.enLlamada',
  no_molestar: 'pres.noMolestar',
  desconectado: 'pres.desconectado'
};

/** El estado de presencia de un amigo, normalizado a los seis del contrato §9. */
function estadoDe(amigo) {
  if (!amigo.online) return 'desconectado';
  const estado = amigo.actividad && amigo.actividad.estado;
  return CLAVE_ESTADO[estado] ? estado : 'libre';
}

/**
 * La agenda de la pantalla: quién hay y cuántas solicitudes esperan.
 *
 * LA LISTA NO ES SUYA: vive en `useSocialStore`, que el contrato §6 declara
 * dueño de `amigos[]` y `solicitudes[]`. Aquí sólo se lee y se ordena. Si el
 * carril guardara su propia copia en un `useState`, abrir la lista de amigos
 * mientras el hub está detrás dejaría dos listas del mismo dato divergiendo en
 * cuanto una de las dos se perdiera un evento.
 *
 * El hook vive aquí y no dentro del carril porque la barra de identidad
 * necesita las mismas solicitudes para su insignia: una sola lectura para las
 * dos piezas.
 *
 * POR QUÉ ESTE EFECTO SIGUE EXISTIENDO, teniendo el store un `iniciarSocial()`
 * que hace justo esto: `iniciarSocial()` registra además `profile_data`, y
 * `useGameSocket.test.jsx` afirma que ese evento tiene EXACTAMENTE un listener
 * mientras `<App/>` está montado (el suyo, el que aplica las skins), y que al
 * desmontar la aplicación no queda NINGUNO colgado —y los del store no se
 * retiran nunca, a propósito—. Así que el hub alimenta el store con los dos
 * eventos que sí puede escuchar y los retira al salir. Cuando alguien mueva el
 * perfil a un store, este efecto entero desaparece y aquí queda el selector.
 *
 * Los listeners se registran DENTRO del efecto, nunca en ámbito de módulo:
 * `fakeSocket.reset()` vacía el mapa de handlers en cada afterEach, así que unos
 * registrados al importar sobrevivirían un solo test por archivo y después
 * ninguno, en verde y en silencio.
 *
 * CONSECUENCIA CONOCIDA: con la lista de amigos abierta encima del hub hay dos
 * manejadores de `friends_data`, el del store y éste. No divergen —los dos
 * escriben el mismo valor en el mismo sitio— y el segundo se va al cerrar el
 * hub. La alternativa era que el carril no supiera nada hasta abrir un modal.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAgenda() {
  const { cuentaId, capacidades } = useGameStore();
  const gente = useSocialStore((estado) => estado.amigos);
  const solicitudes = useSocialStore((estado) => estado.solicitudes);

  // Sin persistencia no hay agenda que pedir: `getFriends` devuelve [] sin pool,
  // así que preguntar sólo gastaría un evento del cubo de frecuencia para
  // recibir un vacío.
  const hayAgenda = Boolean(capacidades.persistencia && capacidades.amigos);

  useEffect(() => {
    if (!hayAgenda) return undefined;

    function alLlegarAmigos(datos) {
      if (!datos) return;
      useSocialStore.setState({
        amigos: Array.isArray(datos.friends) ? datos.friends : [],
        solicitudes: Array.isArray(datos.requests) ? datos.requests : []
      });
    }
    // Diferencial: el servidor manda UN amigo, no la lista entera (antes eran
    // 1+2N consultas secuenciales por conexión para cambiar un punto de color).
    function alCambiarPresencia(datos) {
      if (!datos || !datos.id) return;
      useSocialStore.setState((estado) => ({
        amigos: estado.amigos.map((amigo) => (
          amigo.id === datos.id
            ? { ...amigo, online: !!datos.online, actividad: datos.actividad || null }
            : amigo
        ))
      }));
    }

    socket.on('friends_data', alLlegarAmigos);
    socket.on('friend_presence', alCambiarPresencia);
    socket.emit('get_friends', { playerId: cuentaId });

    return () => {
      socket.off('friends_data', alLlegarAmigos);
      socket.off('friend_presence', alCambiarPresencia);
    };
  }, [hayAgenda, cuentaId]);

  const personas = useMemo(() => {
    const conEstado = gente
      .map((amigo) => ({ ...amigo, estado: estadoDe(amigo) }))
      .filter((amigo) => amigo.estado !== 'desconectado');
    return conEstado.sort((a, b) => (ORDEN[a.estado] - ORDEN[b.estado])
      || String(a.username || '').localeCompare(String(b.username || '')));
  }, [gente]);

  return { hayAgenda, personas, solicitudes };
}

export default function CarrilDeGente({ hayAgenda, personas = [], onAbrirAmigos }) {
  const { t } = useT();
  const voz = useVoice();
  const { cuentaId, name, liveGames } = useGameStore();
  // Roving tabindex: un solo botón del carril entra en el orden de tabulación.
  const [indiceActivo, setIndiceActivo] = useState(0);
  const [abierto, setAbierto] = useState(null);
  const refs = useRef([]);

  // El foco no puede quedarse apuntando a una persona que se desconectó.
  useEffect(() => {
    setIndiceActivo((i) => Math.min(i, Math.max(0, personas.length - 1)));
  }, [personas.length]);

  const enfocar = useCallback((indice) => {
    setIndiceActivo(indice);
    const nodo = refs.current[indice];
    if (!nodo) return;
    nodo.focus();
    // `nearest` en los dos ejes: el carril desplaza en horizontal y no debe
    // arrastrar la página entera al saltar de persona.
    if (nodo.scrollIntoView) nodo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const alPulsarTecla = (evento, indice) => {
    const ultimo = personas.length - 1;
    if (evento.key === 'ArrowRight') { evento.preventDefault(); enfocar(indice === ultimo ? 0 : indice + 1); }
    else if (evento.key === 'ArrowLeft') { evento.preventDefault(); enfocar(indice === 0 ? ultimo : indice - 1); }
    else if (evento.key === 'Home') { evento.preventDefault(); enfocar(0); }
    else if (evento.key === 'End') { evento.preventDefault(); enfocar(ultimo); }
    else if (evento.key === 'Escape' && abierto) { evento.preventDefault(); setAbierto(null); enfocar(indice); }
  };

  const llamar = (persona) => {
    setAbierto(null);
    // La firma de la voz se consulta en el momento: `useVoice()` puede devolver
    // null (los tableros se renderizan sin proveedor) y el motor está siendo
    // reescrito por P5-VOZ. Si no hay a quién pedírselo, no se finge que sí.
    const pedir = voz && (voz.callFriend || voz.llamar);
    if (pedir) pedir.call(voz, persona.id, name || '');
  };

  const retar = (persona) => {
    setAbierto(null);
    socket.emit('friend_challenge', { playerId: cuentaId, name: name || '', friendId: persona.id });
  };

  const verPartida = (persona) => {
    setAbierto(null);
    socket.emit('spectate_room', { roomId: persona.actividad.roomId });
  };

  /** Sólo se ofrece ver la partida de alguien si esa partida es PÚBLICA. */
  const sePuedeVer = (persona) => persona.estado === 'jugando'
    && persona.actividad && persona.actividad.roomId
    && (liveGames || []).some((partida) => partida.roomId === persona.actividad.roomId);

  const nombreAccesible = (persona) => {
    const nombre = persona.username || '';
    if (persona.estado === 'no_molestar') return t('hub.noMolestaA', { name: nombre });
    if (persona.estado === 'en_llamada') return t('hub.pedirEntrar', { name: nombre });
    if (persona.estado === 'jugando') return `${t('hub.llamarA', { name: nombre })} · ${t('pres.jugando')}`;
    return t('hub.llamarA', { name: nombre });
  };

  return (
    <section className="vest-carril" aria-label={t('hub.gente')}>
      <h2 className="vest-carril-titulo">{t('hub.gente')}</h2>

      {!hayAgenda && (
        <div className="ov-degradado vest-carril-vacio">
          <span>{t('degradado.sinAmigos')}</span>
          <span className="vest-carril-pista">{t('degradado.puedesLlamarMesa')}</span>
        </div>
      )}

      {hayAgenda && personas.length === 0 && (
        <div className="vest-carril-vacio">
          <span>{t('hub.nadieEnLinea')}</span>
        </div>
      )}

      {hayAgenda && personas.length > 0 && (
        <ul className="vest-carril-lista">
          {personas.map((persona, indice) => (
            <li key={persona.id} className="vest-persona">
              <button
                type="button"
                ref={(nodo) => { refs.current[indice] = nodo; }}
                className={`vest-persona-btn estado-${persona.estado}`}
                tabIndex={indice === indiceActivo ? 0 : -1}
                aria-label={nombreAccesible(persona)}
                aria-expanded={abierto === persona.id}
                // PROHIBIDO el atributo `disabled` (CONTRATO §10): un botón
                // deshabilitado desaparece del recorrido y no puede explicar por
                // qué no se puede pulsar. Se anuncia y se rechaza en el manejador.
                aria-disabled={persona.estado === 'no_molestar'}
                onKeyDown={(evento) => alPulsarTecla(evento, indice)}
                onFocus={() => setIndiceActivo(indice)}
                onClick={() => {
                  if (persona.estado === 'no_molestar') return;
                  setAbierto((actual) => (actual === persona.id ? null : persona.id));
                }}
              >
                <span
                  className="vest-persona-avatar"
                  aria-hidden="true"
                  style={{
                    background: `color-mix(in srgb, ${colorDeJugador(persona.id)} 18%, var(--sup-2))`,
                    borderColor: colorDeJugador(persona.id)
                  }}
                >
                  {(persona.username || '?').charAt(0).toUpperCase()}
                  <span className={`vest-persona-punto punto-${persona.estado}`} />
                </span>
                <span className="vest-persona-nombre">{persona.username}</span>
                <span className="vest-persona-estado">
                  <span aria-hidden="true">{GLIFO[persona.estado]}</span>
                  {' '}
                  {t(CLAVE_ESTADO[persona.estado])}
                </span>
              </button>

              {abierto === persona.id && (
                <div className="vest-persona-acciones" role="group" aria-label={persona.username}>
                  <button type="button" className="vest-accion primaria" onClick={() => llamar(persona)}>
                    {persona.estado === 'en_llamada'
                      ? <PhoneIncoming size={16} aria-hidden="true" />
                      : <Phone size={16} aria-hidden="true" />}
                    {persona.estado === 'en_llamada'
                      ? t('hub.pedirEntrar', { name: persona.username })
                      : t('hub.llamarA', { name: persona.username })}
                  </button>
                  <button type="button" className="vest-accion" onClick={() => retar(persona)}>
                    <Swords size={16} aria-hidden="true" />
                    {t('hub.retar')}
                  </button>
                  {sePuedeVer(persona) && (
                    <button type="button" className="vest-accion" onClick={() => verPartida(persona)}>
                      <Eye size={16} aria-hidden="true" />
                      {t('hub.verPartida')}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Añadir por código cierra el carril, como pide el orden del spec. Va
          FUERA de la lista y con tabulación normal: no es una persona, así que
          meterlo en el roving tabindex lo dejaría alcanzable sólo con ←/→ desde
          dentro del carril, y con el carril vacío no habría desde dónde. */}
      {hayAgenda && onAbrirAmigos && (
        <button type="button" className="vest-carril-accion vest-mas" onClick={onAbrirAmigos}>
          <UserPlus size={16} aria-hidden="true" />
          {/* `friend.add` («Agregar»), no `hub.amigos`: el raíl de la barra de
              identidad ya tiene un botón llamado «Amigos» y dos controles con el
              mismo nombre accesible en la misma pantalla no se distinguen. */}
          {t('friend.add')}
        </button>
      )}
    </section>
  );
}
