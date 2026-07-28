import React from 'react';
import { Eye, LogOut, Bot, Shield, Zap } from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher';
import { useT } from '../i18n/LanguageContext';
import { obtenerTableroEspectador } from '../games/registry';

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
  // El tablero lo decide el juego, no este componente: antes pintaba siempre el
  // de dominó, así que espectar un tres en raya mostraba una mesa vacía.
  const Tablero = obtenerTableroEspectador(g.gameType);

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
              {/* Las fichas en mano son cosa del dominó: en otros juegos
                  `handCount` no existe y se pintaba una tira vacía con un
                  número en blanco al lado. */}
              {typeof p.handCount === 'number' && (
                <span className="spec-tiles" title={t('seat.tiles', { n: p.handCount })}>
                  {Array.from({ length: Math.min(p.handCount, 10) }).map((_, i) => <i key={i} />)}
                  <b>{p.handCount}</b>
                </span>
              )}
              {p.symbol && <span className="spec-symbol">{p.symbol}</span>}
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
          {/* `playerId` vacío a propósito: ningún asiento coincide, así que el
              tablero se pinta sin controles y las casillas quedan inertes. */}
          <Tablero gameState={g} playerId="" onLeave={onLeave} />
        </div>
      </div>
    </div>
  );
}
