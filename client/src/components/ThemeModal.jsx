import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import { TABLES, SKINS, getTable, getSkin, applyTable, applySkin } from '../theme';

// Mini ficha de dominó para previsualizar un skin.
function TilePreview({ bg, pip }) {
  return (
    <span className="theme-tile-preview" style={{ background: bg }}>
      {[0, 1, 2, 3].map(i => (
        <i key={i} style={{ background: pip }} />
      ))}
    </span>
  );
}

// Personalización del aspecto: tema de mesa y skin de fichas. Se aplica en vivo
// al pulsar (y se guarda), así que se ve el cambio al instante.
export default function ThemeModal({ onClose }) {
  const { t } = useT();
  const [table, setTable] = useState(getTable());
  const [skin, setSkin] = useState(getSkin());

  const pickTable = (id) => { applyTable(id); setTable(id); };
  const pickSkin = (id) => { applySkin(id); setSkin(id); };

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up theme-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-close" onClick={onClose} aria-label={t('common.cancel')}>
          <X size={18} />
        </button>
        <div className="profile-sub" style={{ marginBottom: '16px' }}>{t('theme.title')}</div>

        <div className="theme-section-label">{t('theme.tables')}</div>
        <div className="theme-grid">
          {TABLES.map(tb => (
            <button
              key={tb.id}
              className={`theme-swatch ${table === tb.id ? 'sel' : ''}`}
              onClick={() => pickTable(tb.id)}
            >
              <span className="theme-felt" style={{ background: tb.bg }}>
                {table === tb.id && <Check size={16} />}
              </span>
              <span className="theme-name">{t(`theme.table.${tb.id}`)}</span>
            </button>
          ))}
        </div>

        <div className="theme-section-label">{t('theme.tiles')}</div>
        <div className="theme-grid">
          {SKINS.map(sk => (
            <button
              key={sk.id}
              className={`theme-swatch ${skin === sk.id ? 'sel' : ''}`}
              onClick={() => pickSkin(sk.id)}
            >
              <TilePreview bg={sk.bg} pip={sk.pip} />
              <span className="theme-name">{t(`theme.skin.${sk.id}`)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
