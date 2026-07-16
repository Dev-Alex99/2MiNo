import React, { useState } from 'react';
import { Copy, Check, Users, Sparkles, LogOut, CheckCircle2, Zap, Layers, Medal, Bot, X, Download, ArrowLeftRight } from 'lucide-react';
import { socket } from '../socket';
import VoiceChat from './VoiceChat';

const BOT_LEVELS = [
  { id: 'facil', label: 'Fácil' },
  { id: 'normal', label: 'Normal' },
  { id: 'dificil', label: 'Difícil' }
];

export default function WaitingRoom({ gameState, playerId, onLeave }) {
  const [copied, setCopied] = useState(false);
  const [botLevel, setBotLevel] = useState('normal');
  const [swapFrom, setSwapFrom] = useState(null);
  const me = gameState.players.find(p => p.id === playerId);
  const totalPlayers = gameState.players.length;
  const isFull = totalPlayers >= 4;

  const addBot = () => {
    socket.emit('add_bot', { roomId: gameState.roomId, difficulty: botLevel });
  };

  const removeBot = (botId) => {
    socket.emit('remove_bot', { roomId: gameState.roomId, botId });
  };

  // Intercambio de asientos: se elige uno y luego con quién cambiarlo.
  const handleSwapClick = (id) => {
    if (!swapFrom) return setSwapFrom(id);
    if (swapFrom === id) return setSwapFrom(null);
    socket.emit('swap_seats', { roomId: gameState.roomId, playerA: swapFrom, playerB: id });
    setSwapFrom(null);
  };

  // Si el jugador elegido se va de la sala, cancelamos la selección.
  const swapFromExists = gameState.players.some(p => p.id === swapFrom);
  if (swapFrom && !swapFromExists) setSwapFrom(null);

  const swapFromName = gameState.players.find(p => p.id === swapFrom)?.name;

  const copyCode = () => {
    navigator.clipboard.writeText(gameState.roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleReady = () => {
    socket.emit('toggle_ready', { roomId: gameState.roomId, playerId });
  };

  // Genera un avatar simple pero elegante basado en iniciales del nombre
  const getAvatarColor = (name) => {
    const colors = [
      'from-emerald-400 to-teal-600',
      'from-indigo-400 to-purple-600',
      'from-rose-400 to-pink-600',
      'from-amber-400 to-orange-600',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="waiting-room-screen">
      <div className="waiting-room-card glass-panel animate-scale-up">
        
        {/* Cabecera Sala */}
        <div className="waiting-room-header-row">
          <div>
            <span className="waiting-room-header-subtitle">
              <Sparkles size={12} /> Sala Privada Activa
            </span>
            <h2 className="waiting-room-header-title">Sala de Espera</h2>

            {/* Modalidad fijada por el anfitrión al crear la sala */}
            <div className="room-mode-tags">
              <span className="room-mode-tag">
                <Layers size={11} />
                Doble {gameState.maxPip ?? 6}
              </span>
              {gameState.teamsEnabled && (
                <span className="room-mode-tag teams">
                  <Users size={11} />
                  Parejas 2v2
                </span>
              )}
              {gameState.drawEnabled === false && (
                <span className="room-mode-tag">
                  <Download size={11} />
                  Sin pozo
                </span>
              )}
              <span className={`room-mode-tag ${gameState.powersEnabled === false ? '' : 'accent'}`}>
                <Zap size={11} />
                {gameState.powersEnabled === false ? 'Clásico, sin poderes' : 'Con poderes'}
              </span>
              <span className="room-mode-tag">
                <Medal size={11} />
                {gameState.maxScore ?? 100} pts
              </span>
            </div>
          </div>
          <button 
            onClick={onLeave}
            className="waiting-room-leave-btn"
            title="Salir de la sala"
          >
            <LogOut size={20} />
          </button>
        </div>

        {/* Panel del código de sala */}
        <div className="code-box">
          <span className="code-box-header">Código para unirse</span>
          <div className="code-box-row">
            <span className="code-box-value">{gameState.roomId}</span>
            <button onClick={copyCode} className="code-box-copy-btn">
              {copied ? <Check size={18} style={{ color: '#10b981' }} /> : <Copy size={18} />}
            </button>
          </div>
          {copied && <span className="code-box-copy-toast">¡Código copiado al portapapeles!</span>}
        </div>

        {/* Chat de voz: disponible ya desde aquí, para coordinaros antes de
            empezar. La llamada sigue viva al arrancar la partida. */}
        <VoiceChat playerId={playerId} players={gameState.players} />

        {/* Lista de Jugadores */}
        <div className="waiting-players-section">
          <div className="waiting-players-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Users size={14} /> Jugadores ({totalPlayers}/4)
            </span>
            <span>Estado</span>
          </div>

          {/* Pista del intercambio en curso */}
          {swapFrom && (
            <div className="swap-hint">
              <ArrowLeftRight size={13} />
              <span>Elige con quién intercambiar a <strong>{swapFromName}</strong></span>
              <button onClick={() => setSwapFrom(null)} className="select-hint-cancel">
                Cancelar
              </button>
            </div>
          )}

          {gameState.teamsEnabled && !swapFrom && (
            <div className="swap-tip">
              Cambia de sitio con ⇄ para elegir compañero: los asientos alternos forman pareja
            </div>
          )}

          <div className="waiting-players-list">
            {gameState.players.map((player) => (
              <div 
                key={player.id}
                className={`player-row ${player.id === playerId ? 'me' : ''}`}
              >
                <div className="player-row-left">
                  {/* Avatar */}
                  <div className={`player-avatar bg-gradient-to-br ${getAvatarColor(player.name)}`}>
                    {player.isBot
                      ? <Bot size={15} />
                      : player.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="player-row-name-box">
                    <span className="player-row-name">
                      {player.name}
                      {player.id === playerId && (
                        <span className="player-badge-me">Tú</span>
                      )}
                      {player.isBot && <span className="player-badge-bot">Bot</span>}
                    </span>
                    <span className="player-row-role">
                      {gameState.teamsEnabled && (
                        <span className={`team-chip team-${player.team}`}>
                          {(gameState.teamNames || ['Equipo A', 'Equipo B'])[player.team]}
                        </span>
                      )}
                      {player.isBot
                        ? (BOT_LEVELS.find(l => l.id === player.difficulty)?.label || 'Normal')
                        : 'Jugador'}
                    </span>
                  </div>
                </div>

                {/* Estado Ready / cambiar sitio / quitar bot */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {player.ready ? (
                    <span className="badge-ready">Listo</span>
                  ) : (
                    <span className="badge-waiting">Esperando</span>
                  )}

                  {totalPlayers > 1 && (
                    <button
                      onClick={() => handleSwapClick(player.id)}
                      className={`seat-swap-btn ${swapFrom === player.id ? 'active' : ''} ${swapFrom && swapFrom !== player.id ? 'target' : ''}`}
                      title={
                        swapFrom === player.id
                          ? 'Cancelar'
                          : swapFrom
                            ? `Intercambiar ${swapFromName} con ${player.name}`
                            : `Cambiar de sitio a ${player.name}`
                      }
                      aria-label={`Cambiar de sitio a ${player.name}`}
                    >
                      <ArrowLeftRight size={13} />
                    </button>
                  )}

                  {player.isBot && (
                    <button
                      onClick={() => removeBot(player.id)}
                      className="bot-remove-btn"
                      title={`Quitar a ${player.name}`}
                      aria-label={`Quitar a ${player.name}`}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Ranuras vacías */}
            {Array.from({ length: 4 - totalPlayers }).map((_, idx) => (
              <div key={`empty-${idx}`} className="player-row-empty">
                <div className="empty-avatar">?</div>
                <span>Esperando jugador...</span>
              </div>
            ))}
          </div>

          {/* Rellenar con bots: no hace falta esperar a nadie para jugar */}
          <div className="bot-add-box">
            <span className="bot-add-label">
              <Bot size={13} />
              Añadir un bot
            </span>
            <div className="bot-add-controls">
              <div className="bot-level-group" role="group" aria-label="Dificultad del bot">
                {BOT_LEVELS.map((lvl) => (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setBotLevel(lvl.id)}
                    aria-pressed={botLevel === lvl.id}
                    className={`bot-level-btn ${botLevel === lvl.id ? 'active' : ''}`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
              <button
                onClick={addBot}
                disabled={isFull}
                className="btn-premium btn-secondary bot-add-btn"
                title={isFull ? 'La sala está llena' : 'Añadir bot a la mesa'}
              >
                <Bot size={15} />
                {isFull ? 'Mesa llena' : 'Añadir'}
              </button>
            </div>
          </div>
        </div>

        {/* Panel de control "Listo" */}
        <div className="waiting-footer">
          <button
            onClick={handleToggleReady}
            className={`btn-premium ${me?.ready ? 'btn-secondary' : 'btn-primary'}`}
            style={{ width: '100%', padding: '16px', fontSize: '1.05rem' }}
          >
            {me?.ready ? 'Cancelar Listo' : 'Marcar que estoy Listo'}
          </button>
          
          <div className="waiting-footer-desc">
            {gameState.teamsEnabled && totalPlayers < 4
              ? `Las parejas se juegan 2 contra 2: faltan ${4 - totalPlayers} jugador${4 - totalPlayers > 1 ? 'es' : ''} (puedes añadir bots)`
              : totalPlayers < 2
                ? 'Se necesitan al menos 2 jugadores para iniciar la partida'
                : 'El juego comenzará automáticamente cuando todos estén Listos'
            }
          </div>
        </div>

      </div>
    </div>
  );
}
