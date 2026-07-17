import React, { useState, useRef, useEffect } from 'react';
import { Globe, Check } from 'lucide-react';
import { LANGS } from '../i18n/translations';
import { useT } from '../i18n/LanguageContext';

// Selector de idioma. `compact` para la barra de juego (solo la bandera).
export default function LanguageSwitcher({ compact = false }) {
  const { lang, setLang } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className={`lang-switcher ${compact ? 'compact' : ''}`} ref={ref}>
      <button
        className="lang-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Idioma / Language"
      >
        <Globe size={compact ? 14 : 15} />
        {!compact && <span className="lang-btn-label">{LANGS[lang].flag} {LANGS[lang].label}</span>}
        {compact && <span className="lang-btn-flag">{LANGS[lang].flag}</span>}
      </button>

      {open && (
        <ul className="lang-menu" role="listbox">
          {Object.entries(LANGS).map(([code, info]) => (
            <li key={code}>
              <button
                role="option"
                aria-selected={code === lang}
                className={`lang-option ${code === lang ? 'active' : ''}`}
                onClick={() => { setLang(code); setOpen(false); }}
              >
                <span>{info.flag} {info.label}</span>
                {code === lang && <Check size={13} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
