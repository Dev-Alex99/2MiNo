import React from 'react';
import { Eye, LogOut, Bot, Shield, Zap } from 'lucide-react';
import GameBoard from './GameBoard';
import LanguageSwitcher from './LanguageSwitcher';
import { useT } from '../i18n/LanguageContext';

const noop = () => {};

function initials(name) {
  return (name || '?').substring(0, 2).toUpperCase();
}

/**
 * Vista de espectador: el tablero en vivo y el estado de cada jugador, SIN ver
 * ninguna mano (el servidor ya envía una vista sin manos ni poderes). No hay
 * controles ni voz: es solo mirar.
 */
export default function SpectatorView({ gameState, onLeave }) {
  const { t } = useT();
  const g = gameState;
  const players = g.players || [];

  return (
    <div className="app-container spectator">
      <div className="spec-bar">
        <span className="spec-badge"><Eye size={14} /> {t('spec.badge')}</span>
        <span className="spec-room">#{g.roomId} · R{g.roundNumber || 1}</span>
        <div className="spec-bar-right">
          <LanguageSwitcher compact />
          <button className="spec-leave" onClick={onLeave}>
            <LogOut size={15} /> {t('spec.leave')}
          </button>
        </div>
      </div>

      {/* Estado de cada jugador (sin manos) */}
      <div className="spec-players">
        {players.map((p) => (
          <div
            key={p.id}
            className={`spec-player ${p.id === g.currentPlayerId ? 'active' : ''} ${
              g.teamsEnabled ? `team-${p.team}` : ''
            }`}
          >
            <span className="spec-avatar">
              {p.isBot ? <Bot size={14} /> : initials(p.name)}
              {p.shieldActive && <Shield size={9} className="spec-shield" />}
            </span>
            <span className="spec-pname">{p.name}</span>
            <span className="spec-pmeta">
              <span className="spec-tiles" title={t('seat.tiles', { n: p.handCount })}>
                {Array.from({ length: Math.min(p.handCount, 10) }).map((_, i) => <i key={i} />)}
                <b>{p.handCount}</b>
              </span>
              <span className="spec-score">{p.score} {t('common.points')}</span>
              {g.powersEnabled && p.powersCount > 0 && (
                <span className="spec-powers"><Zap size={9} />{p.powersCount}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="game-area">
        <div className="board-region spec-board">
          <GameBoard
            board={g.board}
            selectedTileIndex={null}
            onPlay={noop}
            isMyTurn={false}
            players={players}
            currentPlayerId={g.currentPlayerId}
            canPlayLeft={false}
            canPlayRight={false}
            pendingTargetType={null}
            onSelectEndTarget={noop}
            activeEffects={g.activeEffects}
            lastPlay={g.lastPlay}
            seatsPadding={40}
          />
        </div>
      </div>
    </div>
  );
}
