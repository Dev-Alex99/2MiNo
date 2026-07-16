import React, { useState } from 'react';
import { Volume2, VolumeX, Medal, Layers, WifiOff, Star, ShieldAlert } from 'lucide-react';
import { toggleMute, getMuteState } from '../audio';

export default function ScoreBoard({
  players,
  currentPlayerId,
  playerId,
  roomId,
  roundNumber,
  boneyardCount,
  pendingTargetType,
  onSelectPlayerTarget,
  maxScore = 100,
  maxPip = 6,
  powersEnabled = true
}) {
  const [muted, setMuted] = useState(getMuteState());

  const handleMuteToggle = () => {
    const isMutedNow = toggleMute();
    setMuted(isMutedNow);
  };

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
    <div className="sidebar">
      
      {/* Cabecera Sidebar */}
      <div className="sidebar-top">
        <div className="sidebar-header">
          <div className="sidebar-title-box">
            <span className="sidebar-subtitle">Ronda Activa</span>
            <span className="sidebar-title">
              <Layers size={18} style={{ color: '#6366f1' }} />
              Ronda #{roundNumber || 1}
            </span>
          </div>

          {/* Mute Button */}
          <button 
            onClick={handleMuteToggle}
            className={`mute-btn ${muted ? 'active' : ''}`}
            title={muted ? "Activar Sonido" : "Silenciar Sonido"}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>

        <div className="separator" />

        {/* Lista de Jugadores */}
        <div>
          <span className="sidebar-section-title">Clasificación</span>
          
          <div className="players-list">
            {players.map((player) => {
              const isActive = player.id === currentPlayerId;
              const isMe = player.id === playerId;
              const showTargetOverlay = !isMe && (
                pendingTargetType === 'player_target' || 
                pendingTargetType === 'smuggle_select_player'
              );
              
              return (
                <div 
                  key={player.id}
                  className={`player-card ${isActive ? 'active-turn' : ''} ${player.shieldActive ? 'shielded' : ''}`}
                  style={{ position: 'relative' }}
                >
                  {showTargetOverlay && (
                    <div 
                      className="target-player-overlay"
                      onClick={() => onSelectPlayerTarget(player.id)}
                    >
                      🎯 ELEGIR
                    </div>
                  )}

                  <div className="player-card-row">
                    <div className="player-info-left">
                      {/* Avatar */}
                      <div className={`player-avatar bg-gradient-to-br ${getAvatarColor(player.name)}`}>
                        {player.name.substring(0, 2).toUpperCase()}
                      </div>

                      <div className="player-meta">
                        <span className="player-name">
                          {player.name}
                          {isMe && <span className="player-badge-me">TÚ</span>}
                          {player.isBot && <span className="player-badge-bot">BOT</span>}
                          {powersEnabled && player.powersCount > 0 && (
                            <span 
                              style={{ color: '#fbbf24', marginLeft: '6px', fontSize: '0.65rem', fontWeight: 800 }}
                              title={`${player.powersCount} cartas de poder`}
                            >
                              ⚡{player.powersCount}
                            </span>
                          )}
                        </span>
                        
                        {player.handCount === 0 && player.score >= maxScore && (
                          <span style={{ color: '#f59e0b', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                            <Star size={10} fill="currentColor" /> Ganador
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Fichas restantes en mano */}
                    <div className="player-hand-indicator">
                      <span className="player-tile-icon" />
                      <span className="player-tile-count">{player.handCount}</span>
                    </div>
                  </div>

                  {/* Scorebar global y puntuación */}
                  <div className="player-score-row">
                    <span className="player-score-label">Puntuación:</span>
                    <div className="player-score-value">
                      <Medal size={14} style={{ color: '#f59e0b' }} />
                      <span>{player.score} / {maxScore} pts</span>
                    </div>
                  </div>

                  {/* Barra de progreso visual hacia el límite de la sala */}
                  <div className="player-score-bar">
                    <div
                      className="player-score-progress"
                      style={{ width: `${Math.min(100, (player.score / maxScore) * 100)}%` }}
                    />
                  </div>

                  {/* Fichas reveladas por espía */}
                  {player.hand && player.hand.length > 0 && !isMe && (
                    <div className="revealed-hand-row" style={{
                      display: 'flex',
                      gap: '4px',
                      marginTop: '8px',
                      padding: '4px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '8px',
                      overflowX: 'auto',
                      width: '100%',
                      boxSizing: 'border-box'
                    }}>
                      {player.hand.map((tile, tIdx) => (
                        <div 
                          key={tIdx} 
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            background: '#f8fafc',
                            color: '#0f172a',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            padding: '2px 4px',
                            fontSize: '0.65rem',
                            fontWeight: 'bold',
                            minWidth: '18px',
                            textAlign: 'center',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                          }}
                        >
                          <div>{tile[0]}</div>
                          <div style={{ borderTop: '1px solid #cbd5e1', width: '100%', margin: '1px 0' }}></div>
                          <div>{tile[1]}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Info Sala y Pozo en Footer */}
      <div className="sidebar-bottom">
        <div className="info-box">
          <div className="info-box-left">
            <span className="info-box-label">Pozo Restante</span>
            <span className="info-box-value">Fichas: {boneyardCount}</span>
          </div>
          <div className="info-box-deck">
            {Array.from({ length: Math.min(3, boneyardCount) }).map((_, idx) => (
              <div 
                key={idx} 
                className="deck-mini-tile" 
              />
            ))}
          </div>
        </div>

        <div className="info-box">
          <div>
            <span className="info-box-label">Código de Sala</span>
            <span className="room-code-value">{roomId}</span>
          </div>
          <div className="info-box-label" style={{ fontSize: '0.6rem', textAlign: 'right' }}>
            Doble {maxPip}
            <br />
            {powersEnabled ? 'Con Poderes' : 'Clásico'}
          </div>
        </div>
      </div>

    </div>
  );
}
