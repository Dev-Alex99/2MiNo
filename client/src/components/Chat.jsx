import React, { useState } from 'react';
import { MessageSquare, Smile, MessageCircle } from 'lucide-react';
import { socket } from '../socket';

const QUICK_PHRASES = [
  '¡Capicúa!',
  '¡Paso!',
  '¡Juego cerrado!',
  '¡Toma tu doble seis!',
  '¡Buena jugada!',
  '¡El que sabe, sabe!',
  '¡Suerte para la próxima!',
  '¡Pensando la jugada...'
];

const QUICK_EMOJIS = ['😂', '😎', '😮', '🤫', '😠', '👑', '🔥', '👏'];

export default function Chat({ roomId, playerId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('emojis'); // 'emojis' | 'phrases'

  const sendPhrase = (phrase) => {
    socket.emit('send_quick_message', {
      roomId,
      playerId,
      text: phrase,
      type: 'phrase'
    });
    setIsOpen(false);
  };

  const sendEmoji = (emoji) => {
    socket.emit('send_quick_message', {
      roomId,
      playerId,
      text: emoji,
      type: 'emoji'
    });
    setIsOpen(false);
  };

  return (
    <div className="chat-fab-container">
      
      {/* Botón flotante para abrir el menú de chat */}
      <button onClick={() => setIsOpen(!isOpen)} className="chat-fab">
        <MessageSquare size={20} />
      </button>

      {/* Menú de chat rápido */}
      {isOpen && (
        <div className="chat-menu glass-panel animate-scale-up">
          
          {/* Selector de pestañas */}
          <div className="chat-tabs">
            <button
              onClick={() => setActiveTab('emojis')}
              className={`chat-tab-btn ${activeTab === 'emojis' ? 'active' : ''}`}
            >
              <Smile size={14} /> Emojis
            </button>
            <button
              onClick={() => setActiveTab('phrases')}
              className={`chat-tab-btn ${activeTab === 'phrases' ? 'active' : ''}`}
            >
              <MessageCircle size={14} /> Frases
            </button>
          </div>

          {/* Contenido de la pestaña */}
          <div>
            {activeTab === 'emojis' ? (
              <div className="emojis-grid">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => sendEmoji(emoji)}
                    className="emoji-btn"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : (
              <div className="phrases-list">
                {QUICK_PHRASES.map((phrase) => (
                  <button
                    key={phrase}
                    onClick={() => sendPhrase(phrase)}
                    className="phrase-btn"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
