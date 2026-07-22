import React, { useState, useEffect, useCallback } from 'react';
import { X, UserPlus, Check, Users, Copy, Zap, UserCheck, UserX, Swords } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { getOrCreatePersistentPlayerId } from '../store/useGameStore';

export default function FriendsModal({ name, onClose }) {
  const { t } = useT();
  const pid = getOrCreatePersistentPlayerId();
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [myCode, setMyCode] = useState('');
  const [addCode, setAddCode] = useState('');
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  const flash = useCallback((text, type = 'ok') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  }, []);

  useEffect(() => {
    socket.emit('get_friends', { playerId: pid });
    socket.emit('get_profile', { playerId: pid, username: name || 'Jugador' });

    function onFriends(data) {
      if (data) { setFriends(data.friends || []); setRequests(data.requests || []); }
    }
    function onProfile(data) { if (data && data.friend_code) setMyCode(data.friend_code); }
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
    try { navigator.clipboard.writeText(myCode); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* noop */ }
  };
  const addFriend = (e) => {
    e.preventDefault();
    const c = addCode.trim().toUpperCase();
    if (c) { socket.emit('friend_add', { playerId: pid, code: c }); setAddCode(''); }
  };
  const respond = (otherId, accept) => socket.emit('friend_respond', { playerId: pid, otherId, accept });
  const challenge = (friendId) => socket.emit('friend_challenge', { playerId: pid, name: name || 'Jugador', friendId });

  return (
    <div className="modal-overlay animate-fade-in" style={{ zIndex: 1200 }} onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up" style={{ maxWidth: '460px', width: '94%', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>

        <div className="modal-header-with-icon" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="modal-icon-circle winner" style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={22} color="#34d399" />
          </div>
          <div>
            <h2 className="modal-title" style={{ fontSize: '1.25rem', margin: 0 }}>{t('friend.title')}</h2>
            <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{t('friend.subtitle')}</span>
          </div>
        </div>

        {/* Tu código */}
        <button type="button" className="tourney-code-box" onClick={copyCode} title={t('friend.copyCode')} style={{ margin: '14px 0' }}>
          <span className="tourney-code-label">
            {copied ? <><Check size={11} /> {t('tourney.copied')}</> : <><Copy size={11} /> {t('friend.yourCode')}</>}
          </span>
          <span className="tourney-code" style={{ fontSize: '1.5rem' }}>{myCode || '·····'}</span>
        </button>

        {/* Agregar por código */}
        <form onSubmit={addFriend} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            className="lobby-input" style={{ flex: 1, textTransform: 'uppercase' }}
            placeholder={t('friend.addPlaceholder')} value={addCode} maxLength={5}
            onChange={(e) => setAddCode(e.target.value.toUpperCase())}
          />
          <button type="submit" className="btn-premium btn-primary" style={{ padding: '0 14px' }} disabled={!addCode.trim()}>
            <UserPlus size={16} /> {t('friend.add')}
          </button>
        </form>

        {msg && (
          <div style={{ padding: '7px 10px', marginBottom: '10px', borderRadius: '8px', fontSize: '0.82rem', textAlign: 'center',
            background: msg.type === 'err' ? 'rgba(239,68,68,0.16)' : 'rgba(16,185,129,0.16)',
            color: msg.type === 'err' ? '#fca5a5' : '#34d399' }}>{msg.text}</div>
        )}

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {/* Solicitudes recibidas */}
          {requests.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div className="profile-section-label"><UserPlus size={14} /> {t('friend.requests')} ({requests.length})</div>
              {requests.map((r) => (
                <div key={r.id} className="friend-row">
                  <span className="friend-name">{r.username}</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="friend-accept" onClick={() => respond(r.id, true)} title={t('friend.acceptBtn')}><UserCheck size={15} /></button>
                    <button className="friend-decline" onClick={() => respond(r.id, false)} title={t('friend.declineBtn')}><UserX size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Lista de amigos */}
          <div className="profile-section-label"><Users size={14} /> {t('friend.list')} ({friends.length})</div>
          {friends.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280', fontSize: '0.85rem' }}>{t('friend.empty')}</div>
          ) : (
            friends.map((f) => (
              <div key={f.id} className="friend-row">
                <span className="friend-name">
                  <span className={`friend-dot ${f.online ? 'online' : ''}`} />
                  {f.username}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="friend-elo"><Zap size={11} /> {f.elo || 1200}</span>
                  {f.online && (
                    <button className="friend-challenge-btn" onClick={() => challenge(f.id)} title={t('friend.challenge')}>
                      <Swords size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
