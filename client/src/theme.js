// Personalización visual unificada: tema de mesa y skin de fichas.
// Se aplica escribiendo variables CSS en :root y se guarda en localStorage.
// La mesa (--bg-table) solo afecta al tablero; las fichas usan --tile-bg/--tile-pip.
//
// Los IDs de este catálogo se mapean 1:1 con los IDs de la tienda (SkinStoreModal)
// y de la base de datos (tabla owned_skins). Cualquier ID que aparezca en la
// tienda DEBE tener una entrada visual aquí; si no la tiene, se usa el fallback.

/* ─── Tapetes de mesa (--bg-table) ─── */
export const TABLES = [
  // Gratis
  { id: 'emerald',      bg: 'radial-gradient(circle at center, #0f3d30 0%, #041410 100%)' },
  // De pago (coinciden con BOARD_THEMES de la tienda)
  { id: 'dark_oak',     bg: 'radial-gradient(circle at center, #292524 0%, #0c0a09 100%)' },
  { id: 'neon_galaxy',  bg: 'radial-gradient(circle at center, #0f172a 0%, #1e3a5f 100%)' },
  { id: 'mayan_temple', bg: 'radial-gradient(circle at center, #451a03 0%, #1c0b01 100%)' },
  { id: 'ocean_deep',   bg: 'radial-gradient(circle at center, #0c4a6e 0%, #041c2c 100%)' },
  { id: 'blood_moon',   bg: 'radial-gradient(circle at center, #450a0a 0%, #1c0404 100%)' },
  { id: 'zen_garden',   bg: 'radial-gradient(circle at center, #57534e 0%, #1c1917 100%)' },
  { id: 'cyber_grid',   bg: 'radial-gradient(circle at center, #1e1b4b 0%, #030712 100%)' },
];

/* ─── Skins de fichas (--tile-bg, --tile-pip) ─── */
export const SKINS = [
  // Gratis
  { id: 'classic',       bg: 'linear-gradient(135deg, #ffffff 0%, #f6f6eb 100%)', pip: '#111827' },
  // De pago (coinciden con TILE_SKINS de la tienda)
  { id: 'cyberpunk',     bg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', pip: '#00ffcc' },
  { id: 'obsidian',      bg: 'linear-gradient(135deg, #1e1b4b 0%, #0f0d2e 100%)', pip: '#a78bfa' },
  { id: 'walnut',        bg: 'linear-gradient(135deg, #78350f 0%, #451a03 100%)', pip: '#fde68a' },
  { id: 'rose_gold',     bg: 'linear-gradient(135deg, #fde8ee 0%, #f8cdd9 100%)', pip: '#9f1239' },
  { id: 'midnight',      bg: 'linear-gradient(135deg, #0c4a6e 0%, #082f49 100%)', pip: '#7dd3fc' },
  { id: 'volcanic',      bg: 'linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)', pip: '#fbbf24' },
  { id: 'arctic',        bg: 'linear-gradient(135deg, #cffafe 0%, #a5f3fc 100%)', pip: '#0e7490' },
  { id: 'jade',          bg: 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)', pip: '#34d399' },
  { id: 'golden_dragon', bg: 'linear-gradient(135deg, #1f1f23 0%, #0a0a0d 100%)', pip: '#fbbf24' },
];

const TABLE_KEY = 'domino_table';
const SKIN_KEY  = 'domino_skin';

function read(key, def) { try { return localStorage.getItem(key) || def; } catch { return def; } }
function write(key, v) { try { localStorage.setItem(key, v); } catch { /* modo privado */ } }

export function getTable() {
  const id = read(TABLE_KEY, 'emerald');
  return TABLES.some(t => t.id === id) ? id : 'emerald';
}
export function getSkin() {
  const id = read(SKIN_KEY, 'classic');
  return SKINS.some(s => s.id === id) ? id : 'classic';
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
