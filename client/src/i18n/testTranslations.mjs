// Paridad del diccionario de traducciones: todos los idiomas deben exponer
// EXACTAMENTE las mismas claves. Sin esto, una clave añadida solo en español
// llega a producción como texto en español (o como la clave cruda) para los
// demás idiomas, y nadie se entera hasta que un usuario la ve.
//
// Corre con node puro (sin dependencias):  node client/src/i18n/testTranslations.mjs
import assert from 'node:assert';
import { translations, LANGS } from './translations.js';

const langs = Object.keys(translations);
const base = 'es'; // español es el idioma fuente
assert.ok(langs.includes(base), 'Debe existir el idioma base "es"');

const baseKeys = Object.keys(translations[base]).sort();
console.log(`Idiomas: ${langs.join(', ')} · claves en "${base}": ${baseKeys.length}`);

let problems = 0;
for (const lang of langs) {
  const keys = Object.keys(translations[lang]).sort();
  const missing = baseKeys.filter(k => !keys.includes(k));
  const extra = keys.filter(k => !baseKeys.includes(k));
  const dupes = keys.filter((k, i) => keys[i - 1] === k);

  if (missing.length) { console.log(`✗ [${lang}] faltan ${missing.length}: ${missing.slice(0, 8).join(', ')}`); problems++; }
  if (extra.length) { console.log(`✗ [${lang}] sobran ${extra.length}: ${extra.slice(0, 8).join(', ')}`); problems++; }
  if (dupes.length) { console.log(`✗ [${lang}] duplicadas: ${dupes.slice(0, 8).join(', ')}`); problems++; }

  // Ninguna traducción debe estar vacía.
  const empty = keys.filter(k => typeof translations[lang][k] !== 'string' || translations[lang][k].trim() === '');
  if (empty.length) { console.log(`✗ [${lang}] vacías: ${empty.slice(0, 8).join(', ')}`); problems++; }

  if (!missing.length && !extra.length && !dupes.length && !empty.length) {
    console.log(`✓ [${lang}] ${keys.length} claves, paridad completa`);
  }
}

// Cada idioma declarado en LANGS debe tener diccionario.
for (const code of Object.keys(LANGS)) {
  if (!translations[code]) { console.log(`✗ LANGS declara "${code}" pero no hay diccionario`); problems++; }
}

assert.strictEqual(problems, 0, `${problems} problema(s) de paridad en las traducciones`);
console.log(`\n=== TODAS LAS PRUEBAS DE TRADUCCIONES PASARON (${langs.length} idiomas × ${baseKeys.length} claves) ===`);
