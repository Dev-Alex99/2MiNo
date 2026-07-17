import React, { useState } from 'react';
import { useT } from '../i18n/LanguageContext';

// Renderiza un icono SVG personalizado vectorizado para cada carta de poder
const PowerCardIcon = ({ id }) => {
  const props = {
    width: "28",
    height: "28",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "power-card-svg-icon"
  };

  switch (id) {
    case 'double_shot':
      return (
        <svg {...props} strokeWidth="2.5">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case 'smuggle':
      return (
        <svg {...props}>
          <rect x="3" y="9" width="18" height="12" rx="2" ry="2" />
          <path d="M12 2v7M7.5 4.5l9 9" />
        </svg>
      );
    case 'spy_eye':
      return (
        <svg {...props}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'skip':
      return (
        <svg {...props}>
          <polygon points="5 4 15 12 5 20 5 4" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </svg>
      );
    case 'draw_penalty':
      return (
        <svg {...props}>
          <circle cx="12" cy="5" r="3" />
          <line x1="12" y1="8" x2="12" y2="20" />
          <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
        </svg>
      );
    case 'reverse':
      return (
        <svg {...props}>
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
      );
    case 'trade':
      return (
        <svg {...props}>
          <path d="M17 1l4 4-4 4" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'freeze':
      return (
        <svg {...props}>
          <line x1="12" y1="2" x2="12" y2="22" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M20 16l-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4" />
        </svg>
      );
    case 'destiny_steal':
      return (
        <svg {...props}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
    case 'mind_swap':
      return (
        <svg {...props}>
          <path d="M16 3h5v5M8 21H3v-5" />
          <path d="M21 3L14 10M3 21l7-7" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'tile_demolition':
      return (
        <svg {...props}>
          <circle cx="11" cy="13" r="7" />
          <path d="M16 8l3-3M22 2l-2 2M11 6V2M19 8h4" />
        </svg>
      );
    case 'wildcard':
      return (
        <svg {...props}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case 'boneyard_reset':
      return (
        <svg {...props}>
          <path d="M2.5 2v6h6M21.5 22v-6h-6" />
          <path d="M22 11.5A10.5 10.5 0 0 0 11.5 1 10.5 10.5 0 0 0 1 11.5 10.5 10.5 0 0 0 11.5 22H16" />
        </svg>
      );
    case 'magnetic_pull':
      return (
        <svg {...props}>
          <path d="M12 2a8 8 0 0 0-8 8v6c0 2 2 4 4 4s4-2 4-4v-6a4 4 0 0 1 8 0v6c0 2-2 4-4 4" />
        </svg>
      );
    case 'russian_roulette':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="6" r="1.5" />
          <circle cx="12" cy="18" r="1.5" />
          <circle cx="6" cy="12" r="1.5" />
          <circle cx="18" cy="12" r="1.5" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      );
  }
};


export default function PowerCards({ 
  powers = [], 
  isMyTurn = false, 
  onUsePower,
  selectedPower,
  setSelectedPower,
  pendingTargetType,
  setPendingTargetType
}) {
  const { t } = useT();
  const [hoveredCard, setHoveredCard] = useState(null);

  const handleCardClick = (card) => {
    if (!isMyTurn) return;

    if (selectedPower && selectedPower.id === card.id) {
      setSelectedPower(null);
      setPendingTargetType(null);
      return;
    }

    setSelectedPower(card);

    if (card.id === 'smuggle') {
      setPendingTargetType('smuggle_select_tile'); 
    } else if (['spy_eye', 'draw_penalty', 'destiny_steal', 'mind_swap', 'magnetic_pull'].includes(card.id)) {
      setPendingTargetType('player_target');
    } else if (['freeze', 'tile_demolition'].includes(card.id)) {
      setPendingTargetType('end_target');
    } else if (card.id === 'trade') {
      setPendingTargetType('hand_tile_target');
    } else {
      // Instantáneos (double_shot, reverse, shield, wildcard, boneyard_reset, russian_roulette)
      setPendingTargetType(null);
      onUsePower(card.id, null, null);
      setSelectedPower(null);
    }
  };

  if (powers.length === 0) return null;

  return (
    <div className="power-cards-wrap">
      {/* En móvil esta cabecera se oculta: las cartas se explican solas y ahí
          cada píxel se lo quita al tablero. */}
      <div className="power-cards-title">
        {t('powers.title')} ({powers.length})
      </div>

      <div className="power-cards-container">
        {powers.map((card, idx) => {
          const isSelected = selectedPower && selectedPower.id === card.id;
          const isDisabled = !isMyTurn;
          
          return (
            <div 
              key={`${card.id}-${idx}`}
              className={`power-card-item ${card.type || 'buff'} ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
              onClick={() => handleCardClick(card)}
              onMouseEnter={() => setHoveredCard(card)}
              onMouseLeave={() => setHoveredCard(null)}
              title={t(`pw.${card.id}.d`)}
            >
              <span className="power-card-icon">
                <PowerCardIcon id={card.id} />
              </span>
              <span className="power-card-title">{t(`pw.${card.id}.n`)}</span>
              <span className="power-card-type-label">{t(`ptype.${card.type || 'buff'}`)}</span>
            </div>
          );
        })}
      </div>

      {(hoveredCard || selectedPower) && (
        <div style={{
          marginTop: '6px',
          padding: '6px 12px',
          background: 'rgba(0,0,0,0.7)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          fontSize: '0.7rem',
          color: '#e2e8f0',
          maxWidth: '300px',
          textAlign: 'center',
          lineHeight: '1.3',
          backdropFilter: 'blur(4px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
        }}>
          <strong>{t(`pw.${(hoveredCard || selectedPower).id}.n`)}:</strong> {t(`pw.${(hoveredCard || selectedPower).id}.d`)}
          {selectedPower && promptKey(pendingTargetType) && (
            <div style={{ color: '#34d399', fontWeight: 700, marginTop: '4px', animation: 'pulse-glow 1.5s infinite' }}>
              {t(promptKey(pendingTargetType))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function promptKey(pendingType) {
  switch (pendingType) {
    case 'smuggle_select_tile': return 'prompt.smuggleTile';
    case 'smuggle_select_player': return 'prompt.smugglePlayer';
    case 'player_target': return 'prompt.player';
    case 'end_target': return 'prompt.end';
    case 'hand_tile_target': return 'prompt.handTile';
    default: return null;
  }
}
