import React, { useState } from 'react';
import { X, Swords, Plus, LogIn } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

// Punto de entrada al torneo: crear uno nuevo o unirse con un código.
export default function TournamentEntry({ onCreate, onJoin, onClose }) {
  const { t } = useT();
  const [code, setCode] = useState('');

  const submitJoin = (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) onJoin(c);
  };

  return (
    <div className="modal-overlay animate-fade-in" style={{ zIndex: 1200 }} onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up" style={{ maxWidth: '420px', width: '92%' }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>

        <div className="modal-header-with-icon" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="modal-icon-circle winner" style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Swords size={22} color="#c4b5fd" />
          </div>
          <div>
            <h2 className="modal-title" style={{ fontSize: '1.25rem', margin: 0 }}>{t('tourney.hubTitle')}</h2>
            <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{t('tourney.entrySub')}</span>
          </div>
        </div>

        <button className="btn-premium btn-primary" style={{ width: '100%', padding: '14px', marginTop: '18px' }} onClick={onCreate}>
          <Plus size={18} /> {t('tourney.create')}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '16px 0', color: '#6b7280', fontSize: '0.75rem' }}>
          <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
          {t('tourney.orJoin')}
          <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
        </div>

        <form onSubmit={submitJoin} style={{ display: 'flex', gap: '8px' }}>
          <input
            className="lobby-input"
            style={{ flex: 1, textTransform: 'uppercase' }}
            placeholder={t('tourney.codePlaceholder')}
            value={code}
            maxLength={5}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="submit" className="btn-premium btn-secondary" style={{ padding: '0 16px' }} disabled={!code.trim()}>
            <LogIn size={16} /> {t('tourney.join')}
          </button>
        </form>
      </div>
    </div>
  );
}
