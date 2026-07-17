import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { translations, LANGS } from './translations';

const STORE_KEY = 'domino_lang';

// Idioma inicial: el guardado por el usuario > el del navegador > español.
function detectLang() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && LANGS[saved]) return saved;
  } catch { /* modo privado */ }

  const nav = (navigator.language || navigator.userLanguage || 'es').toLowerCase();
  if (nav.startsWith('pt')) return 'pt';
  if (nav.startsWith('en')) return 'en';
  // El resto (incluido cualquier variante de español) cae al español, que es
  // el idioma nativo del juego y su audiencia.
  return 'es';
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(detectLang);

  const setLang = useCallback((next) => {
    if (!LANGS[next]) return;
    setLangState(next);
    try { localStorage.setItem(STORE_KEY, next); } catch { /* noop */ }
  }, []);

  // Mantén <html lang> y el título de la pestaña en sincronía con el idioma
  // elegido (accesibilidad y SEO: el atributo debe reflejar lo que se muestra).
  useEffect(() => {
    try {
      document.documentElement.lang = lang;
      const title = (translations[lang] || translations.es)['meta.title'];
      if (title) document.title = title;
    } catch { /* SSR/entorno sin document */ }
  }, [lang]);

  // t(key, params): traduce y sustituye {placeholders}. Si falta la clave en el
  // idioma actual, cae al español; si tampoco está, devuelve la propia clave
  // (así un hueco se ve, en vez de romper la interfaz).
  const t = useCallback((key, params) => {
    const dict = translations[lang] || translations.es;
    let str = dict[key];
    if (str === undefined) str = translations.es[key];
    if (str === undefined) return key;
    if (params) {
      str = str.replace(/\{(\w+)\}/g, (m, p) => (params[p] !== undefined ? params[p] : m));
    }
    return str;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useT() {
  const ctx = useContext(LanguageContext);
  // Fallback defensivo por si algún componente se renderiza fuera del provider.
  if (!ctx) {
    return { lang: 'es', setLang: () => {}, t: (k) => (translations.es[k] ?? k) };
  }
  return ctx;
}
