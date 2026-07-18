import React, { useState, useEffect } from 'react';
import { Eye } from 'lucide-react';
import DominoTile from './DominoTile';
import { useT } from '../i18n/LanguageContext';

/**
 * Overlay que muestra la(s) mano(s) revelada(s) por El Ojo Soplón / Ojo Total,
 * pero SOLO al jugador que lanzó el poder y mientras el efecto está activo. El
 * servidor ya envía las fichas de esas manos solo a este cliente. Es puramente
 * informativo: no bloquea el juego (pointer-events: none), así que puedes seguir
 * jugando mientras lo miras, y desaparece solo cuando caduca.
 */
export default function SpyReveal({ gameState, playerId }) {
  const { t } = useT();
  // Tick local para la cuenta atrás suave (el estado del servidor no llega cada
  // segundo). Barato: un intervalo mientras el componente está montado.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => (n + 1) % 1000), 500);
    return () => clearInterval(id);
  }, []);

  const ae = (gameState && gameState.activeEffects) || {};
  const isEyeOwner = ae.spyEyeActive && ae.spyEyeOwnerId === playerId;
  const isAllOwner = ae.spyAllActive && ae.spyAllOwnerId === playerId;
  if (!isEyeOwner && !isAllOwner) return null;

  const players = gameState.players || [];
  const targets = isAllOwner
    ? players.filter(p => p.id !== playerId)
    : players.filter(p => p.id === ae.spyEyeTargetId);
  const shown = targets.filter(p => Array.isArray(p.hand) && p.hand.length > 0);
  if (shown.length === 0) return null;

  const endTime = isAllOwner ? ae.spyAllEndTime : ae.spyEyeEndTime;
  const seconds = endTime ? Math.max(0, Math.ceil((endTime - Date.now()) / 1000)) : 0;

  return (
    <div className="spy-overlay">
      <div className="spy-panel glass-panel animate-scale-up">
        <div className="spy-header">
          <Eye size={15} />
          <span>{t(isAllOwner ? 'spy.titleAll' : 'spy.title')}</span>
          {seconds > 0 && <span className="spy-timer">{seconds}s</span>}
        </div>
        {shown.map(p => (
          <div key={p.id} className="spy-player">
            <span className="spy-player-name">{p.name}</span>
            <div className="spy-tiles">
              {p.hand.map((tile, i) => (
                <div className="spy-tile" key={i}>
                  <DominoTile tile={tile} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
