import React, { useState } from 'react';
import { ShoppingBag, Trophy, Users, Play, LogIn } from 'lucide-react';
import { socket } from '../socket';
import { useHubStore } from './stores/useHubStore';
import { useGameStore, getOrCreatePersistentPlayerId } from '../store/useGameStore';
import { useT } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import CarrilDeGente, { useAgenda } from './CarrilDeGente';
import { listarCatalogo, PROXIMAMENTE } from './catalogo';
import { colorDeJugador } from '../utils/colorDeJugador';

/**
 * El vestíbulo: quién soy, quién está, dónde voy y qué hay pendiente.
 *
 * Era un folleto. Mentía en sus dos únicas cifras (`lobbyStats?.online || 1`
 * afirmaba UN jugador aunque el servidor dijera cero, y «Salas Abiertas» contaba
 * sólo las de dominó porque leía la lista ya filtrada por juego), no pasaba una
 * sola cadena por `t()`, era la ÚNICA pantalla sin selector de idioma —así que
 * quien jugaba en portugués no podía cambiarlo hasta entrar en un juego— y su
 * acción principal era un `<div onClick>` sin `role`, sin `tabIndex` y sin
 * `onKeyDown`, con tres botones interiores idénticos llamados «Jugar» que no
 * decían de qué juego eran.
 *
 * Cinco bandas, en este orden y por este motivo: primero quién eres (y cómo
 * cambiar de idioma), luego lo que te está esperando (una invitación, una sala
 * a medias), después la gente, después el pulso del servidor, y sólo al final
 * el catálogo. Lo urgente arriba, lo que se elige abajo.
 */
export default function HubDashboard({ onOpenProfile, onOpenStore, onOpenFriends, onOpenLeaderboard }) {
  const { t } = useT();
  const setSelectedGameId = useHubStore((estado) => estado.setSelectedGameId);
  const {
    name, setName, cuentaId, roomId, isConnected, lobbyStats, invitedCode, capacidades
  } = useGameStore();
  const { hayAgenda, personas, solicitudes } = useAgenda();
  const [nombreInvitado, setNombreInvitado] = useState(name);

  const catalogo = listarCatalogo();
  // Sin conexión no hay cifra honesta que enseñar: se pinta «—» y el punto deja
  // de latir. Antes el punto seguía pulsando mientras el marco anunciaba
  // «conexión perdida» tres píxeles más arriba: dos señales contradictorias.
  const cifra = (valor) => (isConnected && lobbyStats ? String(valor) : '—');

  const entrarPorInvitacion = () => {
    const limpio = (nombreInvitado || '').trim();
    if (!limpio || !invitedCode) return;
    setName(limpio);
    socket.emit('join_room', { roomId: invitedCode, name: limpio, playerId: getOrCreatePersistentPlayerId() });
  };

  // La sala VIVA que dejaste a medias. Es el caso contrario al de la sala
  // fantasma, que pinta el marco: cuando aquélla se enciende, `roomId` ya se ha
  // vaciado a propósito para que las dos no puedan salir a la vez.
  const volverALaSala = () => {
    socket.emit('join_room', { roomId, name, playerId: getOrCreatePersistentPlayerId() });
  };

  return (
    <div className="hub-screen vest">
      {/* ─── Banda 1 · identidad ─── */}
      <header className="vest-barra">
        <button type="button" className="vest-yo" onClick={onOpenProfile}>
          <span
            className="vest-yo-avatar"
            aria-hidden="true"
            style={{
              background: `color-mix(in srgb, ${colorDeJugador(cuentaId)} 18%, var(--sup-2))`,
              borderColor: colorDeJugador(cuentaId)
            }}
          >
            {(name || '?').charAt(0).toUpperCase()}
          </span>
          {/* Falta la segunda línea de «ELO · monedas» que pide el spec, y es un
              hueco con dueño, no un olvido: el dato viaja en `profile_data`, que
              ya tiene su único listener en `useGameSocket` —donde se usa sólo
              para aplicar las skins y se descarta— y `useGameSocket.test.jsx`
              afirma que ese evento tiene EXACTAMENTE un listener. Registrar aquí
              el segundo pone en rojo un test de otro paquete. En cuanto alguien
              guarde el perfil en un store, son tres líneas de JSX. */}
          <span className="vest-yo-texto">
            <span className="vest-yo-nombre">{name || t('hub.perfil')}</span>
          </span>
        </button>

        {/* Bajo 768 px estos botones pierden su texto. Antes se quedaban en
            cuatro cuadraditos anónimos de 48x32 sin nombre accesible: el icono
            de lucide no aporta ninguno porque sus SVG no llevan aria-hidden.
            Es un <div> y no un <nav>: no hay ninguna clave que nombre bien este
            raíl, y un punto de referencia mal etiquetado estorba más que la
            ausencia del punto de referencia. El <header> ya aporta el suyo. */}
        <div className="vest-nav">
          <button type="button" className="vest-nav-btn" onClick={onOpenStore} aria-label={t('hub.tienda')}>
            <ShoppingBag size={18} aria-hidden="true" />
            <span className="vest-nav-label">{t('hub.tienda')}</span>
          </button>
          <button type="button" className="vest-nav-btn" onClick={onOpenLeaderboard} aria-label={t('hub.ranking')}>
            <Trophy size={18} aria-hidden="true" />
            <span className="vest-nav-label">{t('hub.ranking')}</span>
          </button>
          <button
            type="button"
            className="vest-nav-btn"
            onClick={onOpenFriends}
            aria-label={solicitudes.length
              ? `${t('hub.amigos')} · ${t('hub.solicitudesN', { n: solicitudes.length })}`
              : t('hub.amigos')}
          >
            <Users size={18} aria-hidden="true" />
            <span className="vest-nav-label">{t('hub.amigos')}</span>
            {solicitudes.length > 0 && (
              <span className="vest-nav-insignia" aria-hidden="true">{solicitudes.length}</span>
            )}
          </button>
          <LanguageSwitcher compact />
        </div>
      </header>

      <main className="vest-cuerpo">
        {/* ─── Banda 0 · la invitación ───
            El enlace de invitación es el principal vector de crecimiento del
            producto y hasta ahora moría aquí: el código se guardaba, la entrada
            automática exigía un nombre que un jugador nuevo no tiene, y el hub
            ni siquiera sabía que había una sala esperando. El cartel vivía dos
            clics más allá, dentro del lobby. */}
        {invitedCode && (
          <section className="vest-invitacion" aria-label={t('hub.invitado', { codigo: invitedCode })}>
            <span className="vest-invitacion-texto">{t('hub.invitado', { codigo: invitedCode })}</span>
            <label className="vest-invitacion-campo">
              <span className="vest-etiqueta">{t('hub.tuNombre')}</span>
              <input
                type="text"
                className="input-premium"
                value={nombreInvitado}
                maxLength={16}
                onChange={(evento) => setNombreInvitado(evento.target.value.substring(0, 16))}
              />
            </label>
            <button type="button" className="btn-premium btn-primary" onClick={entrarPorInvitacion}>
              <LogIn size={16} aria-hidden="true" />
              {t('hub.entrar')}
            </button>
          </section>
        )}

        {/* ─── Banda 0-bis · la sala que dejaste a medias ─── */}
        {roomId && (
          <section className="vest-reanudar vest-reanudar-viva" aria-label={t('hub.volverSala', { sala: roomId })}>
            <span>{t('hub.volverSala', { sala: roomId })}</span>
            <button type="button" className="btn-premium btn-primary" onClick={volverALaSala}>
              {t('hub.volver')}
            </button>
          </section>
        )}

        {/* ─── Banda 2 · la gente ─── */}
        <CarrilDeGente hayAgenda={hayAgenda} personas={personas} onAbrirAmigos={onOpenFriends} />

        {/* ─── Banda 3 · el pulso ───
            Las tres cifras salen de `lobbyStats()`, que YA devuelve
            { online, playing, openRooms } con las salas sin filtrar por juego.
            El cliente tiraba dos de las tres y se inventaba la que quedaba. */}
        <section className="vest-pulso" aria-label={t('hub.enLinea')}>
          <p className="vest-cifra">
            <span className={`vest-cifra-valor ${isConnected ? 'viva' : ''}`}>{cifra(lobbyStats && lobbyStats.online)}</span>
            <span className="vest-cifra-label">{t('hub.enLinea')}</span>
          </p>
          <p className="vest-cifra">
            <span className="vest-cifra-valor">{cifra(lobbyStats && lobbyStats.playing)}</span>
            <span className="vest-cifra-label">{t('hub.jugando')}</span>
          </p>
          <p className="vest-cifra">
            <span className="vest-cifra-valor">{cifra(lobbyStats && lobbyStats.openRooms)}</span>
            <span className="vest-cifra-label">{t('hub.salasAbiertas')}</span>
          </p>
          {!isConnected && <p className="vest-pulso-nota">{t('hub.metricasOffline')}</p>}
          {isConnected && !capacidades.persistencia && (
            <p className="ov-degradado vest-pulso-nota">{t('degradado.sinPersistencia')}</p>
          )}
        </section>

        {/* ─── Banda 4 · el catálogo ───
            Cada tarjeta es un <button> de verdad con el nombre del juego en su
            etiqueta. El «Jugar» interior pasa a <span>: como <button> sin
            onClick propio hacía que las tres tarjetas se anunciaran como tres
            botones idénticos llamados «Jugar», sin ninguna relación con el
            título que tenían 40 px encima. */}
        <section className="vest-catalogo" aria-label={t('hub.catalogo')}>
          <h2 className="vest-catalogo-titulo">{t('hub.catalogo')}</h2>

          <div className="vest-rejilla">
            {catalogo.map((juego) => (
              <button
                key={juego.id}
                type="button"
                className="vest-tarjeta"
                aria-label={t('hub.play', { juego: juego.nombre })}
                onClick={() => setSelectedGameId(juego.id)}
              >
                <span className="vest-tarjeta-icono" aria-hidden="true">{juego.icono}</span>
                {/* El nombre propio del juego NO pasa por t() (CONTRATO §10). */}
                <span className="vest-tarjeta-titulo">{juego.nombre}</span>
                <span className="vest-tarjeta-caps">
                  {juego.capacidades.map((cap) => t(cap.clave, cap.params)).join(' · ')}
                </span>
                <span className="vest-tarjeta-jugar">
                  <Play size={13} fill="currentColor" aria-hidden="true" />
                  {t('hub.jugar')}
                </span>
              </button>
            ))}
          </div>

          {/* Los que todavía no existen ya no gastan una tarjeta: en 375 px una
              tarjeta con candado es una promesa que cuesta una ranura entera. */}
          <p className="vest-proximamente">
            {t('hub.proximamente', { juegos: PROXIMAMENTE.join(' · ') })}
          </p>
        </section>
      </main>
    </div>
  );
}
