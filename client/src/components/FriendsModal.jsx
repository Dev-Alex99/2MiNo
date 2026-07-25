import React, { useState, useEffect, useCallback } from 'react';
import { X, UserPlus, Check, Users, Copy, Zap, UserCheck, UserX, Swords, Phone, Search, Trash2 } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { getOrCreatePersistentPlayerId } from '../store/useGameStore';
import { useVoice } from '../voice/VoiceContext';

export default function FriendsModal({ name, onClose }) {
  const { t } = useT();
  const voice = useVoice();
  const pid = getOrCreatePersistentPlayerId();
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [myCode, setMyCode] = useState('');
  const [addCode, setAddCode] = useState('');
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'online' | 'requests'

  const flash = useCallback((text, type = 'ok') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  }, []);

  useEffect(() => {
    socket.emit('get_friends', { playerId: pid });
    socket.emit('get_profile', { playerId: pid, username: name || 'Jugador' });

    function onFriends(data) {
      if (data) {
        setFriends(data.friends || []);
        setRequests(data.requests || []);
      }
    }
    function onProfile(data) {
      if (data && data.friend_code) setMyCode(data.friend_code);
    }
    function onAction(res) {
      if (!res) return;
      if (res.success) flash(res.accepted ? t('friend.accepted') : t('friend.sent'), 'ok');
      else flash(t(res.error || 'friend.err.generic'), 'err');
    }
    socket.on('friends_data', onFriends);
    socket.on('profile_data', onProfile);
    socket.on('friend_action', onAction);
    return () => {
      socket.off('friends_data', onFriends);
      socket.off('profile_data', onProfile);
      socket.off('friend_action', onAction);
    };
  }, [pid, name, t, flash]);

  const copyCode = () => {
    try {
      navigator.clipboard.writeText(myCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  const addFriend = (e) => {
    e.preventDefault();
    const c = addCode.trim().toUpperCase();
    if (c) {
      socket.emit('friend_add', { playerId: pid, code: c });
      setAddCode('');
    }
  };

  const respond = (otherId, accept) => socket.emit('friend_respond', { playerId: pid, otherId, accept });
  const challenge = (friendId) => socket.emit('friend_challenge', { playerId: pid, name: name || 'Jugador', friendId });

  const handleCall = (friendId) => {
    if (voice && voice.callFriend) {
      voice.callFriend(friendId, name || 'Jugador');
      onClose();
    }
  };

  const removeFriend = (friendId) => {
    socket.emit('friend_remove', { playerId: pid, friendId });
  };

  const filteredFriends = activeTab === 'online' ? friends.filter((f) => f.online) : friends;

  return (
    <div className="modal-overlay animate-fade-in" style={{ zIndex: 1200 }} onClick={onClose}>
      <div className="friends-modal-card animate-scale-up" onClick={(e) => e.stopPropagation()}>
        {/* Header Modal */}
        <div className="friends-modal-header">
          <div className="friends-header-info">
            <div className="friends-icon-badge">
              <Users size={20} />
            </div>
            <div>
              <h2 className="friends-title">Amigos & Contactos</h2>
              <span className="friends-subtitle">Conecta, llama y desafía a tus amigos</span>
            </div>
          </div>

          <button className="friends-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Tarjeta de Código de Amigo Propio */}
        <div className="friend-code-card" onClick={copyCode} title="Haz clic para copiar tu código">
          <div className="friend-code-info">
            <span className="friend-code-label">Tu Código de Amigo</span>
            <span className="friend-code-value">{myCode || '·····'}</span>
          </div>

          <div className={`friend-copy-badge ${copied ? 'copied' : ''}`}>
            {copied ? (
              <>
                <Check size={14} />
                <span>¡Copiado!</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span>Copiar</span>
              </>
            )}
          </div>
        </div>

        {/* Formulario para Añadir Amigo */}
        <form onSubmit={addFriend} className="friend-add-form">
          <div className="friend-input-wrapper">
            <Search size={16} className="friend-input-icon" />
            <input
              className="friend-code-input"
              placeholder="Ingresa el código (ej. AB123)"
              value={addCode}
              maxLength={5}
              onChange={(e) => setAddCode(e.target.value.toUpperCase())}
            />
          </div>
          <button type="submit" className="friend-add-btn" disabled={!addCode.trim()}>
            <UserPlus size={16} />
            <span>Agregar</span>
          </button>
        </form>

        {/* Mensajes de Notificación Flash */}
        {msg && (
          <div className={`friend-flash-msg ${msg.type}`}>
            {msg.text}
          </div>
        )}

        {/* Pestañas de Navegación */}
        <div className="friends-tabs">
          <button
            className={`friend-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            Todos ({friends.length})
          </button>
          <button
            className={`friend-tab ${activeTab === 'online' ? 'active' : ''}`}
            onClick={() => setActiveTab('online')}
          >
            En Línea ({friends.filter((f) => f.online).length})
          </button>
          {requests.length > 0 && (
            <button
              className={`friend-tab ${activeTab === 'requests' ? 'active' : ''}`}
              onClick={() => setActiveTab('requests')}
            >
              Solicitudes ({requests.length})
            </button>
          )}
        </div>

        {/* Lista de Amigos / Solicitudes */}
        <div className="friends-list-container">
          {/* Solicitudes de Amistad Pendientes */}
          {activeTab === 'requests' || (requests.length > 0 && activeTab === 'all') ? (
            requests.length > 0 && (
              <div className="friends-section">
                <div className="friends-section-title">
                  <UserPlus size={14} /> Solicitudes Pendientes ({requests.length})
                </div>
                {requests.map((r) => (
                  <div key={r.id} className="friend-card request-card">
                    <div className="friend-user-info">
                      <div className="friend-avatar-placeholder">
                        {r.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="friend-username">{r.username}</span>
                    </div>

                    <div className="friend-card-actions">
                      <button className="friend-action-icon btn-accept-req" onClick={() => respond(r.id, true)} title="Aceptar Solicitud">
                        <UserCheck size={16} />
                      </button>
                      <button className="friend-action-icon btn-decline-req" onClick={() => respond(r.id, false)} title="Rechazar">
                        <UserX size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : null}

          {/* Lista de Amigos Registrados */}
          {activeTab !== 'requests' && (
            filteredFriends.length === 0 ? (
              <div className="friends-empty-state">
                <Users size={36} className="text-slate-600 mb-2" />
                <p>No tienes amigos en esta lista</p>
                <span className="text-xs text-slate-500">Comparte tu código para agregar a tus amigos</span>
              </div>
            ) : (
              filteredFriends.map((f) => (
                <div key={f.id} className="friend-card">
                  <div className="friend-user-info">
                    <div className="friend-avatar-container">
                      <div className="friend-avatar-placeholder">
                        {f.username.charAt(0).toUpperCase()}
                      </div>
                      <span className={`friend-status-dot ${f.online ? 'online' : 'offline'}`} />
                    </div>

                    <div className="friend-user-details">
                      <span className="friend-username">{f.username}</span>
                      <div className="friend-elo-badge">
                        <Zap size={11} className="text-amber-400" />
                        <span>{f.elo || 1200} ELO</span>
                      </div>
                    </div>
                  </div>

                  <div className="friend-card-actions">
                    {f.online && (
                      <>
                        <button className="friend-action-icon btn-call" onClick={() => handleCall(f.id)} title="Llamada de Voz Directa">
                          <Phone size={15} />
                        </button>
                        <button className="friend-action-icon btn-challenge" onClick={() => challenge(f.id)} title="Desafiar a Partida 1v1">
                          <Swords size={15} />
                        </button>
                      </>
                    )}
                    <button className="friend-action-icon btn-remove" onClick={() => removeFriend(f.id)} title="Eliminar Amigo">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}
