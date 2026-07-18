// Personalización visual: tema de mesa y skin de fichas. 100% cliente: se
// aplica escribiendo variables CSS en :root y se guarda en localStorage. La
// mesa (--bg-table) solo afecta al tablero; las fichas usan --tile-bg/--tile-pip.

export const TABLES = [
  { id: 'green',    bg: 'radial-gradient(circle at center, #0f3d30 0%, #041410 100%)' },
  { id: 'ocean',    bg: 'radial-gradient(circle at center, #0f3350 0%, #04101f 100%)' },
  { id: 'royal',    bg: 'radial-gradient(circle at center, #3a1f52 0%, #14061f 100%)' },
  { id: 'crimson',  bg: 'radial-gradient(circle at center, #4d1a22 0%, #1f0609 100%)' },
  { id: 'charcoal', bg: 'radial-gradient(circle at center, #2b313c 0%, #0b0e13 100%)' },
  { id: 'sunset',   bg: 'radial-gradient(circle at center, #4d3316 0%, #1f1004 100%)' }
];

export const SKINS = [
  { id: 'ivory',    bg: 'linear-gradient(135deg, #ffffff 0%, #f6f6eb 100%)', pip: '#111827' },
  { id: 'obsidian', bg: 'linear-gradient(135deg, #2b303b 0%, #1a1e26 100%)', pip: '#e5e7eb' },
  { id: 'bone',     bg: 'linear-gradient(135deg, #f5efdd 0%, #e6dcc3 100%)', pip: '#4b3b26' },
  { id: 'slate',    bg: 'linear-gradient(135deg, #d3dae4 0%, #aab6c6 100%)', pip: '#1e293b' },
  { id: 'emerald',  bg: 'linear-gradient(135deg, #0e2a22 0%, #08201a 100%)', pip: '#34d399' },
  { id: 'rose',     bg: 'linear-gradient(135deg, #fde8ee 0%, #f8cdd9 100%)', pip: '#9f1239' }
];

const TABLE_KEY = 'domino_table';
const SKIN_KEY = 'domino_skin';

function read(key, def) { try { return localStorage.getItem(key) || def; } catch { return def; } }
function write(key, v) { try { localStorage.setItem(key, v); } catch { /* modo privado */ } }

export function getTable() {
  const id = read(TABLE_KEY, 'green');
  return TABLES.some(t => t.id === id) ? id : 'green';
}
export function getSkin() {
  const id = read(SKIN_KEY, 'ivory');
  return SKINS.some(s => s.id === id) ? id : 'ivory';
}

export function applyTable(id) {
  const t = TABLES.find(x => x.id === id) || TABLES[0];
  try { document.documentElement.style.setProperty('--bg-table', t.bg); } catch { /* SSR */ }
  write(TABLE_KEY, t.id);
}
export function applySkin(id) {
  const s = SKINS.find(x => x.id === id) || SKINS[0];
  try {
    document.documentElement.style.setProperty('--tile-bg', s.bg);
    document.documentElement.style.setProperty('--tile-pip', s.pip);
  } catch { /* SSR */ }
  write(SKIN_KEY, s.id);
}

// Aplica lo guardado al arrancar la app.
export function initTheme() {
  applyTable(getTable());
  applySkin(getSkin());
}
