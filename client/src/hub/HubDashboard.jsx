import React from 'react';
import { useHubStore } from './stores/useHubStore';
import { useGameStore } from '../store/useGameStore';
import { Gamepad2, Trophy, Users, ShoppingBag, User, Sparkles, Play, Lock } from 'lucide-react';

export default function HubDashboard({ onOpenProfile, onOpenStore, onOpenFriends, onOpenLeaderboard }) {
  const { availableGames, setSelectedGameId } = useHubStore();
  const { name, lobbyStats, publicRooms } = useGameStore();

  const onlineCount = lobbyStats?.online || 1;
  const activeRoomsCount = publicRooms?.length || 0;

  return (
    <div className="hub-screen">
      {/* Elementos decorativos de fondo flotando */}
      <div className="hub-glow-1"></div>
      <div className="hub-glow-2"></div>
      <div className="hub-glow-3"></div>

      {/* Header Hub Navigation */}
      <header className="hub-topbar">
        <div className="hub-brand">
          <div className="hub-brand-icon">
            <Gamepad2 size={24} />
          </div>
          <div className="hub-brand-text">
            <h1 className="hub-title">GAME HUB</h1>
            <span className="hub-subtitle">Plataforma Multijugador</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="hub-actions">
          <button onClick={onOpenStore} className="hub-btn hub-btn-store">
            <ShoppingBag size={16} />
            <span>Tienda</span>
          </button>

          <button onClick={onOpenLeaderboard} className="hub-btn hub-btn-ranking">
            <Trophy size={16} />
            <span>Ranking</span>
          </button>

          <button onClick={onOpenFriends} className="hub-btn hub-btn-friends">
            <Users size={16} />
            <span>Amigos</span>
          </button>

          <button onClick={onOpenProfile} className="hub-btn hub-btn-profile">
            <User size={16} />
            <span>{name || 'Mi Perfil'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="hub-main-content">
        {/* Banner Hero */}
        <div className="hub-hero">
          <div className="hub-hero-info">
            <div className="hub-pill">
              <Sparkles size={14} />
              <span>PLATAFORMA MULTIJUGADOR ONLINE</span>
            </div>
            <h2 className="hub-hero-title">Bienvenido al Hub de Juegos</h2>
            <p className="hub-hero-desc">
              Elige tu juego favorito, compite en tiempo real con jugadores de todo el mundo, sube en el ranking clasificatorio y personaliza tu experiencia.
            </p>
          </div>

          {/* Quick Metrics Bar */}
          <div className="hub-metrics-box">
            <div className="hub-metric-item">
              <div className="hub-metric-value text-emerald">
                <span className="pulse-dot" />
                {onlineCount}
              </div>
              <span className="hub-metric-label">En Línea</span>
            </div>

            <div className="hub-metric-divider" />

            <div className="hub-metric-item">
              <div className="hub-metric-value text-indigo">
                {activeRoomsCount}
              </div>
              <span className="hub-metric-label">Salas Abiertas</span>
            </div>
          </div>
        </div>

        {/* Game Cards Section Header */}
        <div className="hub-section-header">
          <div className="hub-section-title">
            <Gamepad2 size={24} className="text-indigo" />
            <h3>Catálogo de Juegos</h3>
          </div>
          <span className="hub-section-subtitle">Selecciona un título para jugar</span>
        </div>

        {/* Game Cards Grid */}
        <div className="hub-games-grid">
          {availableGames.map((game) => {
            const isAvailable = game.status === 'available';

            return (
              <div
                key={game.id}
                onClick={() => isAvailable && setSelectedGameId(game.id)}
                className={`hub-card ${isAvailable ? 'available' : 'disabled'}`}
              >
                {/* Header Icon & Badge */}
                <div className="hub-card-header">
                  <span className="hub-card-icon">{game.icon}</span>
                  <span className={`hub-card-badge ${isAvailable ? 'badge-active' : 'badge-soon'}`}>
                    {game.badge}
                  </span>
                </div>

                {/* Body Details */}
                <div className="hub-card-body">
                  <span className="hub-card-category">{game.category}</span>
                  <h4 className="hub-card-title">{game.name}</h4>
                  <p className="hub-card-desc">{game.description}</p>
                </div>

                {/* Footer Action */}
                <div className="hub-card-footer">
                  <span className="hub-card-players">{game.players}</span>

                  {isAvailable ? (
                    <button className="hub-card-btn">
                      <Play size={14} fill="currentColor" />
                      <span>Jugar</span>
                    </button>
                  ) : (
                    <div className="hub-card-locked">
                      <Lock size={14} />
                      <span>Próximamente</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
