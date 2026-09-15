import React, { useState, useEffect } from 'react';
import { X, UserPlus, Check, Users, Copy, Zap, UserCheck, UserX, Swords, Phone, Search, Trash2 } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { useGameStore } from '../store/useGameStore';
import { useVoice } from '../voice/VoiceContext';
import useModalA11y from '../hooks/useModalA11y';
import { useSocialStore, iniciarSocial, useCapacidades, hayAmigos } from '../social/useSocialStore';

/**
 * La agenda. Es la única puerta de todo el producto para llamar a alguien, así
 * que su modo degradado importa tanto como el normal: sin persistencia no hay
 * lista que enseñar, pero SÍ se puede hablar con quien está en tu mesa, y eso
 * hay que decirlo en vez de pintar un código de amigo de cinco puntos suspensivos
 * que al copiarse anunciaba «¡Copiado!» habiendo copiado la cadena vacía.
 *
 * Los datos ya no son suyos: vienen de useSocialStore, que mantiene UN solo
 * suscriptor vivo aunque el modal esté cerrado. Antes se registraban aquí al
 * montar y se retiraban al cerrar, así que la lista se perdía entera cada vez.
 *
 * PRÉSTAMOS DE COPY, los dos deliberados: `tourney.copied` («¡Copiado!») y
 * `wait.removeBot` («Quitar a {name}»), porque el texto es exactamente el que
 * hace falta y ya está en los tres idiomas. No hay claves `friend.copied` ni
 * `friend.remove`, y declararlas es de P0-I18N, no de aquí. Si algún día
 * existen, esto son dos sustituciones.
 */
export default function FriendsModal({ name, onClose }) {
  const { t } = useT();
  const voice = useVoice();
  const cuentaId = useGameStore((s) => s.cuentaId);
  const capacidades = useCapacidades();
  const conAgenda = hayAmigos(capacidades);

  const amigos = useSocialStore((s) => s.amigos);
  const solicitudes = useSocialStore((s) => s.solicitudes);
  const miCodigo = useSocialStore((s) => s.miCodigo);
  const aviso = useSocialStore((s) => s.aviso);
  const estado = useSocialStore((s) => s.estado);
  const limpiarAviso = useSocialStore((s) => s.limpiarAviso);
  const recargar = useSocialStore((s) => s.recargar);

  const [codigoNuevo, setCodigoNuevo] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [pestana, setPestana] = useState('todos'); // 'todos' | 'enLinea' | 'solicitudes'
  const [porQuitar, setPorQuitar] = useState(null); // id del amigo con la confirmación abierta

  const { propsPanel, propsTitulo } = useModalA11y(onClose);

  useEffect(() => { iniciarSocial(); }, []);

  // El aviso de «Solicitud enviada» se apaga solo; vive en el store porque la
  // respuesta puede llegar con el modal cerrado.
  useEffect(() => {
    if (!aviso) return undefined;
    const id = setTimeout(limpiarAviso, 3000);
    return () => clearTimeout(id);
  }, [aviso, limpiarAviso]);

  /**
   * LA PESTAÑA SE RECONCILIA CON LOS DATOS. La de solicitudes sólo existe
   * mientras hay alguna, así que aceptar la última dejaba `pestana` apuntando a
   * una pestaña que ya no se renderiza: ninguna de las dos ramas de la lista
   * pintaba nada y quedaban 180 px en blanco sin forma de salir salvo cerrar.
   */
  useEffect(() => {
    if (pestana === 'solicitudes' && solicitudes.length === 0) setPestana('todos');
  }, [pestana, solicitudes.length]);

  const copiarCodigo = () => {
    if (!miCodigo) return; // sin código no se anuncia un copiado que no ha pasado
    try {
      navigator.clipboard.writeText(miCodigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1600);
    } catch {
      /* portapapeles bloqueado: el código sigue a la vista para copiarlo a mano */
    }
  };

  const anadirAmigo = (e) => {
    e.preventDefault();
    if (!conAgenda) return;
    const c = codigoNuevo.trim().toUpperCase();
    if (c) {
      socket.emit('friend_add', { playerId: cuentaId, code: c });
      setCodigoNuevo('');
    }
  };

  const responder = (otherId, accept) => socket.emit('friend_respond', { playerId: cuentaId, otherId, accept });
  const retar = (friendId) => socket.emit('friend_challenge', { playerId: cuentaId, name: name || 'Jugador', friendId });

  const llamar = (friendId) => {
    if (voice && voice.callFriend) {
      voice.callFriend(friendId, name || 'Jugador');
      onClose();
    }
  };

  const quitar = (friendId) => {
    socket.emit('friend_remove', { playerId: cuentaId, otherId: friendId, friendId });
    setPorQuitar(null);
  };

  const enLinea = amigos.filter((f) => f.online);
  const listados = pestana === 'enLinea' ? enLinea : amigos;

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div
        className="friends-modal-card modal-a11y animate-scale-up"
        {...propsPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="friends-modal-header">
          <div className="friends-header-info">
            <div className="friends-icon-badge">
              <Users size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="friends-title" {...propsTitulo}>{t('friend.title')}</h2>
              <span className="friends-subtitle">{t('friend.subtitle')}</span>
            </div>
          </div>

          <button type="button" className="friends-close-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* La MISMA franja que el resto de pantallas sociales, con el mismo dato:
            sin persistencia no hay agenda, pero la voz de la mesa sigue viva y
            es lo único que hay que decir aquí. */}
        {!conAgenda && (
          <p className="ov-degradado">
            <span>{t('degradado.sinAmigos')}</span>
            <span className="ov-degradado-pista">{t('degradado.puedesLlamarMesa')}</span>
          </p>
        )}

        {/* El vigilante vencido: el servidor aceptó la petición y no contestó
            nunca. Sin esto la lista se quedaba vacía y muda, indistinguible de
            «todavía no tienes amigos». */}
        {conAgenda && estado === 'sinDatos' && (
          <p className="ov-degradado">
            <span>{t('degradado.noCargado')}</span>
            <button type="button" className="btn-premium btn-secondary" onClick={recargar}>
              {t('degradado.reintentar')}
            </button>
          </p>
        )}

        {/* El bloque del código NO se renderiza sin agenda: pintaba '·····' de
            adorno y su botón anunciaba un copiado de la cadena vacía. */}
        {conAgenda && (
          <div className="friend-code-card">
            <div className="friend-code-info">
              <span className="friend-code-label">{t('friend.yourCode')}</span>
              <span className="friend-code-value">{miCodigo || '—'}</span>
            </div>

            <button
              type="button"
              className={`friend-copy-badge ${copiado ? 'copied' : ''}`}
              onClick={copiarCodigo}
              aria-disabled={miCodigo ? undefined : 'true'}
              aria-label={t('friend.copyCode')}
            >
              {copiado ? (
                <>
                  <Check size={14} aria-hidden="true" />
                  <span>{t('tourney.copied')}</span>
                </>
              ) : (
                <>
                  <Copy size={14} aria-hidden="true" />
                  <span>{t('friend.copyCode')}</span>
                </>
              )}
            </button>
          </div>
        )}

        <form onSubmit={anadirAmigo} className="friend-add-form">
          <div className="friend-input-wrapper">
            <Search size={16} className="friend-input-icon" aria-hidden="true" />
            <input
              className="friend-code-input"
              placeholder={t('friend.addPlaceholder')}
              aria-label={t('friend.addPlaceholder')}
              value={codigoNuevo}
              maxLength={5}
              readOnly={!conAgenda}
              aria-disabled={conAgenda ? undefined : 'true'}
              onChange={(e) => setCodigoNuevo(e.target.value.toUpperCase())}
            />
          </div>
          {/* aria-disabled y rechazo en el manejador: con `disabled` el botón
              sale del orden de tabulación y deja de tener nombre que leer. */}
          <button
            type="submit"
            className="friend-add-btn"
            aria-disabled={(!conAgenda || !codigoNuevo.trim()) ? 'true' : undefined}
          >
            <UserPlus size={16} aria-hidden="true" />
            <span>{t('friend.add')}</span>
          </button>
        </form>

        {/* Región viva propia del diálogo: existe siempre (vacía) para que el
            lector anuncie el cambio, y sólo mientras el modal está abierto. */}
        <div className={`friend-flash-msg ${aviso ? aviso.tipo : 'vacio'}`} role="status">
          {aviso ? t(aviso.clave) : ''}
        </div>

        <div className="friends-tabs">
          <button
            type="button"
            className={`friend-tab ${pestana === 'todos' ? 'active' : ''}`}
            aria-pressed={pestana === 'todos'}
            onClick={() => setPestana('todos')}
          >
            {t('friend.list')} ({amigos.length})
          </button>
          <button
            type="button"
            className={`friend-tab ${pestana === 'enLinea' ? 'active' : ''}`}
            aria-pressed={pestana === 'enLinea'}
            onClick={() => setPestana('enLinea')}
          >
            {t('hub.enLinea')} ({enLinea.length})
          </button>
          {solicitudes.length > 0 && (
            <button
              type="button"
              className={`friend-tab ${pestana === 'solicitudes' ? 'active' : ''}`}
              aria-pressed={pestana === 'solicitudes'}
              onClick={() => setPestana('solicitudes')}
            >
              {t('friend.requests')} ({solicitudes.length})
            </button>
          )}
        </div>

        <div className="friends-list-container">
          {/* Las solicitudes se ven en su pestaña y, si las hay, también en la
              general: son lo único que caduca. */}
          {solicitudes.length > 0 && pestana !== 'enLinea' && (
            <div className="friends-section">
              <div className="friends-section-title">
                <UserPlus size={14} aria-hidden="true" /> {t('friend.requests')} ({solicitudes.length})
              </div>
              {solicitudes.map((r) => (
                <div key={r.id} className="friend-card request-card">
                  <div className="friend-user-info">
                    <div className="friend-avatar-placeholder" aria-hidden="true">
                      {(r.username || '?').charAt(0).toUpperCase()}
                    </div>
                    <span className="friend-username">{r.username}</span>
                  </div>

                  <div className="friend-card-actions">
                    <button
                      type="button"
                      className="friend-action-icon btn-accept-req"
                      onClick={() => responder(r.id, true)}
                      aria-label={t('friend.acceptBtn')}
                      title={t('friend.acceptBtn')}
                    >
                      <UserCheck size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="friend-action-icon btn-decline-req"
                      onClick={() => responder(r.id, false)}
                      aria-label={t('friend.declineBtn')}
                      title={t('friend.declineBtn')}
                    >
                      <UserX size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pestana !== 'solicitudes' && (
            listados.length === 0 ? (
              /* Un vacío que explica qué pasa y ofrece la acción siguiente. Sin
                 agenda la acción es otra, porque el código no existe. */
              <div className="ov-vacio">
                <Users size={36} aria-hidden="true" />
                <p>{conAgenda ? t('friend.empty') : t('degradado.sinAmigos')}</p>
                {conAgenda ? (
                  <button type="button" className="btn-premium btn-secondary" onClick={copiarCodigo} aria-disabled={miCodigo ? undefined : 'true'}>
                    <Copy size={14} aria-hidden="true" /> {t('hub.compartirCodigo')}
                  </button>
                ) : (
                  <span className="ov-vacio-pista">{t('degradado.puedesLlamarMesa')}</span>
                )}
              </div>
            ) : (
              listados.map((f) => (
                <div key={f.id} className="friend-card">
                  <div className="friend-user-info">
                    <div className="friend-avatar-container">
                      <div className="friend-avatar-placeholder" aria-hidden="true">
                        {(f.username || '?').charAt(0).toUpperCase()}
                      </div>
                      <span className={`friend-status-dot ${f.online ? 'online' : 'offline'}`} />
                    </div>

                    <div className="friend-user-details">
                      <span className="friend-username">{f.username}</span>
                      <div className="friend-elo-badge">
                        <Zap size={11} aria-hidden="true" />
                        {/* Sin persistencia el ELO no existe; inventar 1200 es la
                            misma mentira que las 500 monedas del perfil. */}
                        <span>{f.elo != null ? `${f.elo} ELO` : '—'}</span>
                      </div>
                    </div>
                  </div>

                  {porQuitar === f.id ? (
                    /* Confirmación EN SU SITIO: sin window.confirm y sin abrir
                       otro diálogo encima, que haría perder de vista a quién se
                       está quitando. Los dos botones SON la pregunta. */
                    <div className="ov-confirmar" role="group" aria-label={t('wait.removeBot', { name: f.username })}>
                      <button type="button" className="btn-premium ov-peligro" onClick={() => quitar(f.id)}>
                        {t('wait.removeBot', { name: f.username })}
                      </button>
                      <button type="button" className="btn-premium btn-secondary" onClick={() => setPorQuitar(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="friend-card-actions">
                      {f.online && (
                        <>
                          <button
                            type="button"
                            className="friend-action-icon btn-call"
                            onClick={() => llamar(f.id)}
                            aria-label={t('hub.llamarA', { name: f.username })}
                            title={t('hub.llamarA', { name: f.username })}
                          >
                            <Phone size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="friend-action-icon btn-challenge"
                            onClick={() => retar(f.id)}
                            aria-label={t('friend.challenge')}
                            title={t('friend.challenge')}
                          >
                            <Swords size={15} aria-hidden="true" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="friend-action-icon btn-remove"
                        onClick={() => setPorQuitar(f.id)}
                        aria-label={t('wait.removeBot', { name: f.username })}
                        title={t('wait.removeBot', { name: f.username })}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}
