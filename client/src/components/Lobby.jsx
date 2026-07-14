import React, { useState } from 'react';
import { Play, Plus, ArrowRight, User } from 'lucide-react';
import { socket } from '../socket';

export default function Lobby({ name, setName, onCreateRoom, onJoinRoom }) {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Por favor, ingresa tu nombre.');
      return;
    }
    setError('');
    onCreateRoom();
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Por favor, ingresa tu nombre.');
      return;
    }
    if (roomCode.trim().length !== 4) {
      setError('El código de sala debe ser de 4 letras.');
      return;
    }
    setError('');
    onJoinRoom(roomCode.trim().toUpperCase());
  };

  return (
    <div className="lobby-screen">
      {/* Elementos decorativos de fondo flotando */}
      <div className="lobby-glow-1"></div>
      <div className="lobby-glow-2"></div>
      
      {/* Título animado flotante */}
      <div className="lobby-header">
        <h1 className="lobby-title">
          DOMINÓ ONLINE
        </h1>
        <p className="lobby-subtitle">
          Crea una sala privada y juega con tus amigos al instante
        </p>
      </div>

      {/* Tarjeta principal con glassmorphism */}
      <div className="lobby-card glass-panel animate-scale-up">
        <form onSubmit={(e) => e.preventDefault()} className="lobby-form">
          
          {/* Campo de Nombre */}
          <div className="lobby-form-field">
            <label className="lobby-form-label">
              <User size={14} />
              Tu Nombre / Apodo
            </label>
            <input
              type="text"
              placeholder="Ej. Alejandro, ElReyDelPaso..."
              value={name}
              onChange={(e) => setName(e.target.value.substring(0, 16))}
              className="input-premium"
              maxLength={16}
            />
          </div>

          {error && (
            <div className="lobby-error">
              {error}
            </div>
          )}

          <div className="separator"></div>

          {/* Sección de acciones */}
          <div className="lobby-form-field">
            {/* Crear Sala */}
            <button
              onClick={handleCreate}
              type="button"
              className="btn-premium btn-primary"
            >
              <Plus size={18} />
              Crear Nueva Sala
            </button>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', margin: '4px 0' }}>
              <span className="separator" style={{ flexGrow: 1 }}></span>
              <span className="lobby-form-label" style={{ margin: 0 }}>o únete a una</span>
              <span className="separator" style={{ flexGrow: 1 }}></span>
            </div>

            {/* Unirse a Sala */}
            <div className="lobby-join-group">
              <input
                type="text"
                placeholder="Código (Ej. ABCD)"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase().substring(0, 4))}
                className="input-premium"
                style={{ textAlign: 'center', letterSpacing: '0.15em', fontFamily: 'monospace', fontSize: '1.1rem' }}
                maxLength={4}
              />
              <button
                onClick={handleJoin}
                type="submit"
                className="btn-premium btn-secondary"
                style={{ padding: '0 20px' }}
              >
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Footer minimalista */}
      <div className="waiting-footer-desc" style={{ position: 'absolute', bottom: '16px' }}>
        Dominó Clásico Doble Seis · 100 Puntos · Creado con ❤️
      </div>
    </div>
  );
}
