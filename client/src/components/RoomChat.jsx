import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { useGameStore } from '../store/useGameStore';
import { colorDeJugador } from '../utils/colorDeJugador';

const QUICK_PHRASE_KEYS = [
  'chat.p0',
  'chat.p1',
  'chat.p2',
  'chat.p4',
  'chat.p5',
  'chat.p7'
];

export default function RoomChat({ roomId, playerId }) {
  const { t } = useT();
  const [inputText, setInputText] = useState('');
  const [showPhrases, setShowPhrases] = useState(false);
  const messagesEndRef = useRef(null);
  const roomMessages = useGameStore((state) => state.roomMessages || []);

  const scrollToBottom = () => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [roomMessages.length]);

  const handleSendText = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const clean = inputText.trim();
    if (!clean || !roomId) return;

    socket.emit('send_quick_message', {
      roomId,
      playerId,
      text: clean.substring(0, 140),
      type: 'text'
    });

    setInputText('');
  };

  const handleSendPhrase = (key) => {
    if (!roomId) return;
    socket.emit('send_quick_message', {
      roomId,
      playerId,
      text: key,
      type: 'phrase'
    });
    setShowPhrases(false);
  };

  return (
    <div className="room-chat-box" role="region" aria-label={t('chat.title')}>
      <div className="room-chat-header">
        <div className="room-chat-title">
          <MessageSquare size={14} aria-hidden="true" />
          <span>{t('chat.title')}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowPhrases(!showPhrases)}
          className={`room-chat-phrase-toggle ${showPhrases ? 'active' : ''}`}
          aria-expanded={showPhrases}
        >
          {t('chat.phrases')}
        </button>
      </div>

      {showPhrases && (
        <div className="room-chat-phrases-shelf animate-scale-up" role="group">
          {QUICK_PHRASE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleSendPhrase(key)}
              className="room-chat-phrase-chip"
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}

      <div className="room-chat-feed">
        {roomMessages.length === 0 ? (
          <div className="room-chat-empty">
            <span>{t('chat.empty')}</span>
          </div>
        ) : (
          roomMessages.map((msg) => {
            const isMe = msg.playerId === playerId;
            const content = msg.type === 'phrase' || msg.msgKey
              ? t(msg.msgKey || msg.text)
              : msg.text;

            return (
              <div
                key={msg.id}
                className={`room-chat-message ${isMe ? 'is-me' : 'is-other'}`}
              >
                {!isMe && (
                  <div
                    className="room-chat-avatar"
                    style={{ background: colorDeJugador(msg.playerId) }}
                  >
                    {(msg.playerName || '?').substring(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="room-chat-bubble-wrap">
                  {!isMe && msg.playerName && (
                    <span className="room-chat-author">{msg.playerName}</span>
                  )}
                  <div className="room-chat-bubble">
                    <span className="room-chat-text">{content}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendText} className="room-chat-form">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value.substring(0, 140))}
          placeholder={t('chat.placeholder')}
          className="room-chat-input"
          maxLength={140}
          aria-label={t('chat.placeholder')}
        />
        <button
          type="submit"
          className="room-chat-send-btn"
          disabled={!inputText.trim()}
          aria-label={t('chat.send')}
          title={t('chat.send')}
        >
          <Send size={15} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
