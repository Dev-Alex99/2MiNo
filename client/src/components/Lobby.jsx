import React, { useState } from 'react';
import { Play, Plus, ArrowRight, User, Zap, Layers, Settings2, Users, Download, Medal, ChevronDown, Zap as Bolt, Globe, Lock } from 'lucide-react';
import { socket } from '../socket';
import RoomList from './RoomList';

// Debe coincidir con VARIANTS en server/gameLogic.js
const VARIANT_INFO = {
  6: { label: 'Doble 6', desc: '28 fichas · 7 en mano · 100 pts' },
  9: { label: 'Doble 9', desc: '55 fichas · 10 en mano · 200 pts' }
};

export default function Lobby({ name, setName, onCreateRoom, onJoinRoom, onQuickPlay, publicRooms = [], roomsLoading, stats }) {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  // Opciones de sala (solo aplican al CREAR; al unirse manda la config del anfitrión)
  // Poderes OFF por defecto: dominó clásico de entrada, se activan si se quieren.
  const [powersEnabled, setPowersEnabled] = useState(false);
  const [maxPip, setMaxPip] = useState(6);
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [drawEnabled, setDrawEnabled] = useState(true);
  const [maxScore, setMaxScore] = useState(null); // null => el propio de la variante
  const [isPublic, setIsPublic] = useState(true);

  const requireName = () => {
    if (!name.trim()) { setError('Por favor, ingresa tu nombre.'); return false; }
    setError('');
    return true;
  };

  const handleQuick = () => {
    if (requireName()) onQuickPlay();
  };

  const handleJoinFromList = (code) => {
    if (requireName()) onJoinRoom(code);
  };
  // Plegadas por defecto: si no, el botón de crear sala se va de la pantalla
  // en un móvil y hay que scrollear para la acción principal.
  const [showOptions, setShowOptions] = useState(false);

  const optionsSummary = [
    VARIANT_INFO[maxPip].label,
    teamsEnabled ? 'Parejas' : 'Individual',
    powersEnabled ? 'Poderes' : 'Clásico',
    drawEnabled ? null : 'Sin pozo',
    `${maxScore ?? (maxPip === 9 ? 200 : 100)} pts`
  ].filter(Boolean).join(' · ');

  const handleCreate = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Por favor, ingresa tu nombre.');
      return;
    }
    setError('');
    onCreateRoom({ powersEnabled, maxPip, teamsEnabled, drawEnabled, maxScore, isPublic });
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
          Juega al instante o crea tu sala con amigos
        </p>

        {stats && stats.online > 0 && (
          <div className="online-badge" title="Jugadores conectados ahora mismo">
            <span className="online-dot" />
            <strong>{stats.online}</strong>
            {stats.online === 1 ? ' en línea' : ' en línea'}
            {stats.playing > 0 && (
              <span className="online-playing"> · {stats.playing} jugando</span>
            )}
          </div>
        )}
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

          {/* Partida rápida: te sienta en una sala abierta o te abre una. */}
          <button
            type="button"
            onClick={handleQuick}
            className="btn-premium btn-primary quick-play-btn"
          >
            <Bolt size={18} fill="currentColor" />
            Jugar Ahora
          </button>

          {/* Salas públicas abiertas, en vivo */}
          <div className="lobby-form-field">
            <label className="lobby-form-label">
              <Globe size={14} />
              Salas abiertas
            </label>
            <RoomList rooms={publicRooms} loading={roomsLoading} onJoin={handleJoinFromList} />
          </div>

          <div className="separator"></div>

          {/* Opciones de la sala a crear (plegadas por defecto) */}
          <div className="lobby-form-field">
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              className={`options-summary ${showOptions ? 'open' : ''}`}
            >
              <span className="options-summary-main">
                <span className="options-summary-title">
                  <Settings2 size={14} />
                  Opciones de la sala
                </span>
                <span className="options-summary-value">{optionsSummary}</span>
              </span>
              <ChevronDown size={16} className="options-chevron" />
            </button>

            {showOptions && (
              <div className="options-panel">

            {/* Variante del dominó */}
            <div className="segmented" role="group" aria-label="Variante del dominó">
              {[6, 9].map((pip) => (
                <button
                  key={pip}
                  type="button"
                  onClick={() => setMaxPip(pip)}
                  aria-pressed={maxPip === pip}
                  className={`segmented-btn ${maxPip === pip ? 'active' : ''}`}
                >
                  <span className="segmented-title">
                    <Layers size={13} />
                    {VARIANT_INFO[pip].label}
                  </span>
                  <span className="segmented-sub">{VARIANT_INFO[pip].desc}</span>
                </button>
              ))}
            </div>

            {/* Límite de puntos */}
            <div className="segmented" role="group" aria-label="Límite de puntos">
              {[null, 100, 200, 300].map((pts) => (
                <button
                  key={pts ?? 'auto'}
                  type="button"
                  onClick={() => setMaxScore(pts)}
                  aria-pressed={maxScore === pts}
                  className={`segmented-btn compact ${maxScore === pts ? 'active' : ''}`}
                >
                  <span className="segmented-title">
                    {pts === null ? <Medal size={13} /> : null}
                    {pts === null ? 'Auto' : pts}
                  </span>
                  <span className="segmented-sub">
                    {pts === null ? `${maxPip === 9 ? 200 : 100} pts` : 'puntos'}
                  </span>
                </button>
              ))}
            </div>

            {/* Cartas de poder on/off */}
            <button
              type="button"
              onClick={() => setPowersEnabled((v) => !v)}
              aria-pressed={powersEnabled}
              className={`option-toggle ${powersEnabled ? 'on' : ''}`}
            >
              <span className="option-toggle-text">
                <span className="option-toggle-title">
                  <Zap size={14} />
                  Cartas de Poder
                </span>
                <span className="option-toggle-desc">
                  {powersEnabled
                    ? 'Poderes especiales activados'
                    : 'Dominó clásico, sin poderes'}
                </span>
              </span>
              <span className="switch" aria-hidden="true">
                <span className="switch-knob" />
              </span>
            </button>

            {/* Parejas 2v2 */}
            <button
              type="button"
              onClick={() => setTeamsEnabled((v) => !v)}
              aria-pressed={teamsEnabled}
              className={`option-toggle teams ${teamsEnabled ? 'on' : ''}`}
            >
              <span className="option-toggle-text">
                <span className="option-toggle-title">
                  <Users size={14} />
                  Jugar en Parejas
                </span>
                <span className="option-toggle-desc">
                  {teamsEnabled
                    ? '2 contra 2 · requiere 4 jugadores'
                    : 'Cada uno a lo suyo'}
                </span>
              </span>
              <span className="switch" aria-hidden="true">
                <span className="switch-knob" />
              </span>
            </button>

            {/* Robar del pozo */}
            <button
              type="button"
              onClick={() => setDrawEnabled((v) => !v)}
              aria-pressed={drawEnabled}
              className={`option-toggle draw ${drawEnabled ? 'on' : ''}`}
            >
              <span className="option-toggle-text">
                <span className="option-toggle-title">
                  <Download size={14} />
                  Robar del Pozo
                </span>
                <span className="option-toggle-desc">
                  {drawEnabled
                    ? 'Sin jugada, robas del pozo'
                    : 'Sin jugada, pasas turno'}
                </span>
              </span>
              <span className="switch" aria-hidden="true">
                <span className="switch-knob" />
              </span>
            </button>

            {/* Pública o privada */}
            <button
              type="button"
              onClick={() => setIsPublic((v) => !v)}
              aria-pressed={isPublic}
              className={`option-toggle ${isPublic ? 'on' : ''}`}
            >
              <span className="option-toggle-text">
                <span className="option-toggle-title">
                  {isPublic ? <Globe size={14} /> : <Lock size={14} />}
                  {isPublic ? 'Sala Pública' : 'Sala Privada'}
                </span>
                <span className="option-toggle-desc">
                  {isPublic
                    ? 'Cualquiera puede verla y entrar'
                    : 'Solo se entra con el código'}
                </span>
              </span>
              <span className="switch" aria-hidden="true">
                <span className="switch-knob" />
              </span>
            </button>
              </div>
            )}
          </div>

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
        Dominó {VARIANT_INFO[maxPip].label} · {teamsEnabled ? 'Parejas' : 'Individual'}
        {' · '}{powersEnabled ? 'Con Poderes' : 'Clásico'}{!drawEnabled && ' · Sin Pozo'} · Creado con ❤️
      </div>
    </div>
  );
}
