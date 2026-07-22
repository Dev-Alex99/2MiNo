import React, { useState, useEffect } from 'react';
import { Loader2, X, Swords, Zap } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

// Overlay de búsqueda de partida clasificatoria (cola por ELO).
export default function RankedSearch({ onCancel }) {
  const { t } = useT();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="modal-overlay animate-fade-in" style={{ zIndex: 1300 }}>
      <div className="modal-card glass-panel animate-scale-up" style={{ maxWidth: '380px', width: '90%', textAlign: 'center' }}>
        <div className="modal-icon-circle winner" style={{ margin: '0 auto 8px', width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Swords size={26} color="#818cf8" />
        </div>

        <h2 className="modal-title" style={{ fontSize: '1.2rem', margin: '4px 0' }}>{t('mm.searching')}</h2>
        <p style={{ color: '#9ca3af', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <Zap size={13} color="#818cf8" /> {t('mm.subtitle')}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', margin: '18px 0' }}>
          <Loader2 size={22} className="voice-spin" color="#818cf8" />
          <span style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'monospace', color: '#e2e8f0' }}>{mm}:{ss}</span>
        </div>

        <button className="btn-premium btn-secondary" style={{ width: '100%', padding: '12px' }} onClick={onCancel}>
          <X size={16} /> {t('mm.cancel')}
        </button>
      </div>
    </div>
  );
}
