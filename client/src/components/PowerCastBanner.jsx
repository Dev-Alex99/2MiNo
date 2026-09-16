import React, { useState, useEffect } from 'react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';

export default function PowerCastBanner() {
  const { t } = useT();
  const [currentEvent, setCurrentEvent] = useState(null);

  useEffect(() => {
    function handleCast(event) {
      setCurrentEvent(event);
      const timer = setTimeout(() => {
        setCurrentEvent((prev) => (prev === event ? null : prev));
      }, 3200);
      return () => clearTimeout(timer);
    }

    socket.on('power_cast_event', handleCast);
    return () => {
      socket.off('power_cast_event', handleCast);
    };
  }, []);

  if (!currentEvent) return null;

  const {
    playerName,
    cardId,
    cardName,
    type = 'buff',
    rarity = 'common',
    targetName,
    shielded
  } = currentEvent;

  return (
    <div className={'power-cast-banner-overlay rarity-' + rarity + ' type-' + type + (shielded ? ' was-shielded' : '')}>
      <div className="power-cast-banner-halo" />
      <div className="power-cast-banner-card">
        <div className="power-cast-header">
          <span className="power-cast-rarity-tag">{shielded ? 'ESCUDO' : t('powers.rarity.' + rarity)}</span>
          <span className="power-cast-caster-name">{playerName}</span>
        </div>
        <div className="power-cast-body">
          {shielded ? (
            <span className="power-cast-deflect-msg">
              {t('powers.shieldDeflect', { target: targetName || playerName })}
            </span>
          ) : (
            <span className="power-cast-main-msg">
              {t('powers.usedCard', { card: cardName || t('pw.' + cardId + '.n') })}
              {targetName && <span className="power-cast-target-name"> &rarr; {targetName}</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
