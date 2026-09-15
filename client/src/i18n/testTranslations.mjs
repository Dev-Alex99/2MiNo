// Validador del diccionario de traducciones. Todos los idiomas deben exponer
// EXACTAMENTE las mismas claves. Sin esto, una clave añadida solo en español
// llega a producción como texto en español (o como la clave cruda) para los
// demás idiomas, y nadie se entera hasta que un usuario la ve.
//
// Además comprueba lo que la paridad sola no ve: que los {marcadores} de una
// misma clave sean los mismos en los tres idiomas, que las claves que emite el
// servidor existan aquí, y que ninguna llamada a t() apunte a una clave que no
// está declarada.
//
// Y lo que ninguna auditoría de t() puede ver (§7): texto escrito a mano en un
// .jsx, que es como HubDashboard y FriendsModal se quedaron en español para los
// tres idiomas con este validador en verde.
//
// Corre con node puro (sin dependencias):  node client/src/i18n/testTranslations.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translations, LANGS } from './translations.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');           // .../2MiNo
const FUENTE_DICC = path.join(AQUI, 'translations.js');
// El propio validador se excluye del barrido: cita claves de ejemplo en sus
// comentarios y se acusaría a sí mismo de usar claves inexistentes.
const YO = fileURLToPath(import.meta.url);

// Prefijos de claves que se construyen con template literals -- t(`pw.${id}.n`)
// y compañía -- y que por tanto ningún análisis estático puede ver usadas.
// Sin esta lista, el informe de claves huérfanas marcaría media tabla.
const PREFIJOS_DINAMICOS = [
  'pw.', 'ach.', 'store.', 'theme.', 'uno.color.', 'div.',
  'title.', 'mission.', 'history.', 'ptype.', 'rank.', 'opt.int_'
];

// Una clave i18n es un identificador con puntos: 'srv.err.mustDraw', 'log.play'.
const RE_CLAVE = /^[a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;

/* ------------------------------------------ texto incrustado: configuración */

// Letras que sólo aparecen en español o portugués. Buscar acentos en vez de
// "cualquier texto" es deliberado: una cadena con tilde o con «¿¡» dentro de un
// .jsx es texto escrito a mano para el jugador con casi total seguridad, y
// eso da un detector sin ruido. No caza 'Tienda' ni 'Jugar' -- se asume.
const LETRAS_ACENTUADAS = 'áéíóúüñÁÉÍÓÚÜÑàâãçêôõÀÂÃÇÊÔÕ¿¡';
const RE_ACENTUADA = new RegExp(`[${LETRAS_ACENTUADAS}]`);

// Nombres propios que NO se traducen (CONTRATO §10): flujos.test.jsx hace
// getByText('Tres en Raya') / ('Dominó Online') y App.test.jsx los asserta.
// Lista blanca EXACTA, no por subcadena: 'Jugar a Dominó Online' sí es un fallo.
const NOMBRES_PROPIOS = ['Dominó Online', 'Tres en Raya', 'Uno'];

// Deuda conocida, con dueño. Es un TRINQUETE: si un archivo de esta lista sube
// de cadenas incrustadas, la suite se pone roja; si baja, sólo lo avisa (el
// paquete que limpia no es dueño de este archivo y no puede bajar el número él
// mismo, así que un fallo por mejorar bloquearía justo lo que se quiere).
// Un archivo que NO esté aquí no tiene margen: cero cadenas incrustadas.
const DEUDA_TEXTO_INCRUSTADO = new Map([
  ['client/src/components/SkinStoreModal.jsx', { max: 19, quien: 'P8-OVERLAYS' }],
  ['client/src/components/FriendsModal.jsx', { max: 6, quien: 'P8-OVERLAYS' }],
  ['client/src/hub/HubDashboard.jsx', { max: 4, quien: 'P7-VESTIBULO' }],
  ['client/src/components/DeviceSelector.jsx', { max: 3, quien: 'P6-LINEA (se borra)' }]
]);

let problems = 0;
const fallo = (msg) => { console.log(`✗ ${msg}`); problems++; };

/* ---------------------------------------------------------------- utilidades */

// Recorre un directorio saltándose lo que no es fuente nuestra.
function* fuentes(dir, exts) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name === 'dist' || entrada.name.startsWith('.')) continue;
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) yield* fuentes(ruta, exts);
    else if (exts.some(e => entrada.name.endsWith(e))) yield ruta;
  }
}

// Marcadores de interpolación que t() sustituye: /\{(\w+)\}/g.
const marcadores = (texto) => new Set([...texto.matchAll(/\{(\w+)\}/g)].map(m => m[1]));

/* ------------------------------------------- 1. paridad de claves y valores */

const langs = Object.keys(translations);
const base = 'es'; // español es el idioma fuente
assert.ok(langs.includes(base), 'Debe existir el idioma base "es"');

const baseKeys = Object.keys(translations[base]).sort();
console.log(`Idiomas: ${langs.join(', ')} · claves en "${base}": ${baseKeys.length}`);

for (const lang of langs) {
  const keys = Object.keys(translations[lang]).sort();
  const missing = baseKeys.filter(k => !keys.includes(k));
  const extra = keys.filter(k => !baseKeys.includes(k));

  if (missing.length) fallo(`[${lang}] faltan ${missing.length}: ${missing.slice(0, 8).join(', ')}`);
  if (extra.length) fallo(`[${lang}] sobran ${extra.length}: ${extra.slice(0, 8).join(', ')}`);

  // Ninguna traducción debe estar vacía.
  const empty = keys.filter(k => typeof translations[lang][k] !== 'string' || translations[lang][k].trim() === '');
  if (empty.length) fallo(`[${lang}] vacías: ${empty.slice(0, 8).join(', ')}`);

  if (!missing.length && !extra.length && !empty.length) {
    console.log(`✓ [${lang}] ${keys.length} claves, paridad completa`);
  }
}

// Cada idioma declarado en LANGS debe tener diccionario.
for (const code of Object.keys(LANGS)) {
  if (!translations[code]) fallo(`LANGS declara "${code}" pero no hay diccionario`);
}

/* ------------------------------------------------- 2. duplicados en el fuente */

// Hay que leer el FUENTE como texto: si una clave se declara dos veces,
// JavaScript ya se ha quedado con la última al evaluar el objeto y
// Object.keys() nunca devuelve repetidos, así que mirar el objeto no puede
// detectar nada. La declarada primero se pierde en silencio.
{
  const lineas = fs.readFileSync(FUENTE_DICC, 'utf8').split('\n');
  const reBloque = /^ {2}([a-z]{2}): \{/;
  const reDeclarada = /'([a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)'\s*:/g;
  let bloque = null;
  const vistas = new Map();   // idioma -> Set de claves ya declaradas
  const repetidas = [];

  for (const linea of lineas) {
    const m = reBloque.exec(linea);
    if (m) { bloque = m[1]; vistas.set(bloque, new Set()); continue; }
    if (!bloque) continue;
    for (const d of linea.matchAll(reDeclarada)) {
      const clave = d[1];
      const yaVistas = vistas.get(bloque);
      if (yaVistas.has(clave)) repetidas.push(`${bloque}:${clave}`);
      yaVistas.add(clave);
    }
  }

  // El recuento por bloque tiene que cuadrar con el objeto evaluado; si no,
  // el análisis del fuente se ha desalineado y sus resultados no valen.
  for (const [lang, claves] of vistas) {
    const esperadas = Object.keys(translations[lang] || {}).length;
    if (claves.size !== esperadas) {
      fallo(`[${lang}] el fuente declara ${claves.size} claves distintas y el objeto tiene ${esperadas}: el análisis de texto no cuadra`);
    }
  }
  if (repetidas.length) fallo(`claves declaradas dos veces (gana la última): ${repetidas.join(', ')}`);
  else console.log(`✓ sin claves duplicadas en el fuente`);
}

/* ------------------------------------------- 3. marcadores alineados entre idiomas */

// Si el inglés pierde el {n} de 'seat.tiles', el texto sale sin el número y no
// falla nada: la cadena sigue siendo una cadena no vacía.
{
  const desalineadas = [];
  for (const key of baseKeys) {
    const refs = marcadores(translations[base][key]);
    for (const lang of langs) {
      if (lang === base) continue;
      const valor = translations[lang][key];
      if (typeof valor !== 'string') continue; // ya lo ha cazado la paridad
      const suyos = marcadores(valor);
      const faltan = [...refs].filter(p => !suyos.has(p));
      const sobran = [...suyos].filter(p => !refs.has(p));
      if (faltan.length || sobran.length) {
        desalineadas.push(`${lang}/${key}${faltan.length ? ` faltan {${faltan.join('} {')}}` : ''}${sobran.length ? ` sobran {${sobran.join('} {')}}` : ''}`);
      }
    }
  }
  if (desalineadas.length) fallo(`marcadores desalineados (${desalineadas.length}): ${desalineadas.slice(0, 8).join(' · ')}`);
  else console.log(`✓ marcadores {…} alineados en los ${langs.length} idiomas`);
}

/* ------------------------------------- 4. claves que emite el servidor */

// El servidor no tiene diccionario: manda la clave y traduce el cliente. Una
// clave que el servidor emite y aquí no existe se pinta cruda en el aviso,
// porque t() devuelve la propia clave cuando no la encuentra.
{
  const usadas = new Map();  // clave -> primer archivo donde aparece
  for (const ruta of fuentes(path.join(RAIZ, 'server'), ['.js'])) {
    const texto = fs.readFileSync(ruta, 'utf8');
    for (const m of texto.matchAll(/['"`](srv\.[A-Za-z0-9_.]+)['"`]/g)) {
      if (!usadas.has(m[1])) usadas.set(m[1], path.relative(RAIZ, ruta));
    }
  }
  const ausentes = [...usadas].filter(([k]) => translations[base][k] === undefined);
  if (ausentes.length) fallo(`claves srv.* que emite el servidor y no están en el diccionario (${ausentes.length}): ${ausentes.map(([k, f]) => `${k} (${f})`).join(', ')}`);
  else console.log(`✓ las ${usadas.size} claves srv.* del servidor existen en el diccionario`);
}

/* ------------------------------------- 5. claves usadas estáticamente en el cliente */

// Un t('hand.selectEnnd') no rompe nada: se pinta la clave tal cual en la
// interfaz. Aquí se caza en el test en vez de en producción.
const usadasCliente = new Map();   // clave -> archivo
const literalesCliente = new Set(); // cualquier cadena con pinta de clave
{
  // Las tres formas de pedir una traducción con una clave literal: t('x.y'),
  // tRef.current('x.y') (dentro de los manejadores de socket) y
  // formatMessage(t, 'x.y', params) para los mensajes del servidor.
  const reLlamadas = [
    /(?:\bt|\btRef\.current)\(\s*(['"])([^'"\n]+)\1/g,
    /\bformatMessage\(\s*t\s*,\s*(['"])([^'"\n]+)\1/g
  ];
  const reLiteral = /['"`]([a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"`]/g;

  for (const ruta of fuentes(path.join(RAIZ, 'client', 'src'), ['.js', '.jsx', '.mjs'])) {
    if (path.resolve(ruta) === path.resolve(FUENTE_DICC)) continue;
    if (path.resolve(ruta) === path.resolve(YO)) continue;
    const texto = fs.readFileSync(ruta, 'utf8');
    for (const re of reLlamadas) {
      for (const m of texto.matchAll(re)) {
        if (RE_CLAVE.test(m[2]) && !usadasCliente.has(m[2])) usadasCliente.set(m[2], path.relative(RAIZ, ruta));
      }
    }
    for (const m of texto.matchAll(reLiteral)) literalesCliente.add(m[1]);
  }

  const ausentes = [...usadasCliente].filter(([k]) => translations[base][k] === undefined);
  if (ausentes.length) fallo(`claves usadas en el cliente y no declaradas (${ausentes.length}): ${ausentes.map(([k, f]) => `${k} (${f})`).join(', ')}`);
  else console.log(`✓ las ${usadasCliente.size} claves estáticas del cliente existen en el diccionario`);
}

/* ------------------------------------- 6. informe: claves que nadie usa */

// INFORMATIVO A PROPÓSITO, no rompe la suite. Las claves de una pantalla en
// obras se declaran antes que el componente que las consume, así que un fallo
// aquí bloquearía el trabajo por adelantado que este diccionario existe para
// permitir. Sirve para ver de un vistazo lo que ha quedado muerto.
{
  const alcanzables = new Set([...literalesCliente]);
  for (const ruta of fuentes(path.join(RAIZ, 'server'), ['.js'])) {
    const texto = fs.readFileSync(ruta, 'utf8');
    for (const m of texto.matchAll(/['"`]([a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"`]/g)) alcanzables.add(m[1]);
  }
  const huerfanas = baseKeys.filter(k => !alcanzables.has(k) && !PREFIJOS_DINAMICOS.some(p => k.startsWith(p)));
  if (huerfanas.length) {
    console.log(`· aviso: ${huerfanas.length} clave(s) declaradas que nadie usa todavía: ${huerfanas.slice(0, 12).join(', ')}${huerfanas.length > 12 ? ', …' : ''}`);
  } else {
    console.log(`✓ ninguna clave declarada se ha quedado sin uso`);
  }
}

/* ------------------------------------- 7. texto incrustado en los .jsx */

// La auditoría de arriba mira llamadas a t(); por eso no vio nunca que
// HubDashboard.jsx no importe siquiera useT y que FriendsModal.jsx esté escrito
// en español duro encima de 11 claves que ya existían en los tres idiomas. Un
// jugador brasileño abría «Amigos» y leía español, con el diccionario en verde.
//
// Se busca cualquier cadena de más de 3 caracteres con acentos o «¿¡» que no
// pase por t(): literales de cadena Y texto suelto entre etiquetas JSX, que es
// como estaban escritos los dos casos reales (`<span>En Línea</span>`).

// Despieza un fuente en (a) sus literales de cadena y (b) el resto del código
// sin cadenas ni comentarios, alineado línea a línea con el original. Hace
// falta un escáner y no un regex: `'https://x'` lleva un // que no es comentario
// y un comentario puede llevar comillas sin cerrar.
function despiezar(src) {
  const cadenas = [];
  let fuera = '';
  let linea = 1;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {                       // comentario de línea
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {                       // comentario de bloque
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { linea++; fuera += '\n'; }
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {          // literal de cadena
      const comilla = c;
      const lineaIni = linea;
      // Sólo cuenta como argumento de t() si la comilla va pegada a la llamada:
      // t('x'), tRef.current('x'). Un t( dentro de format( no cuela por \b.
      const enT = /(?:\bt|\btRef\.current)\(\s*$/.test(fuera);
      let valor = '';
      i++;
      while (i < src.length && src[i] !== comilla) {
        if (src[i] === '\\') { valor += src[i + 1] ?? ''; i += 2; continue; }
        if (src[i] === '\n') { linea++; fuera += '\n'; }
        valor += src[i];
        i++;
      }
      i++;
      if (!enT) cadenas.push({ valor, linea: lineaIni });
      continue;
    }
    if (c === '\n') linea++;
    fuera += c;
    i++;
  }
  return { fuera, cadenas };
}

const sospechosa = (texto) => {
  const t = texto.trim();
  return t.length > 3 && RE_ACENTUADA.test(t) && !NOMBRES_PROPIOS.includes(t);
};

{
  const encontrados = new Map();   // archivo relativo -> [{ linea, texto }]
  for (const ruta of fuentes(path.join(RAIZ, 'client', 'src'), ['.jsx'])) {
    // Las pruebas describen sus casos en español ('sólo deja pulsar…') y no
    // pintan nada al jugador; el ayudante de render tampoco se publica.
    if (ruta.endsWith('.test.jsx')) continue;
    if (path.relative(RAIZ, ruta).split(path.sep).includes('test')) continue;

    const { fuera, cadenas } = despiezar(fs.readFileSync(ruta, 'utf8'));
    const hallazgos = [];
    for (const c of cadenas) {
      if (sospechosa(c.valor)) hallazgos.push({ linea: c.linea, texto: c.valor.trim() });
    }
    // Texto suelto entre etiquetas. Con las cadenas ya fuera, un `>` seguido de
    // texto y un `<` es JSX salvo casualidad, y la casualidad tendría que
    // llevar tilde dentro para que aquí importe.
    for (const m of fuera.matchAll(/>([^<>{}]+)</g)) {
      if (!sospechosa(m[1])) continue;
      const linea = 1 + (fuera.slice(0, m.index).match(/\n/g) || []).length;
      hallazgos.push({ linea, texto: m[1].trim() });
    }
    if (hallazgos.length) encontrados.set(path.relative(RAIZ, ruta).split(path.sep).join('/'), hallazgos);
  }

  let limpio = true;
  for (const [archivo, hallazgos] of encontrados) {
    const deuda = DEUDA_TEXTO_INCRUSTADO.get(archivo);
    if (!deuda) {
      limpio = false;
      const muestra = hallazgos.slice(0, 4).map(h => `:${h.linea} «${h.texto.slice(0, 48)}»`).join(' · ');
      fallo(`texto incrustado sin t() en ${archivo} (${hallazgos.length}): ${muestra}`);
    } else if (hallazgos.length > deuda.max) {
      limpio = false;
      fallo(`${archivo} sube de ${deuda.max} a ${hallazgos.length} cadenas incrustadas; lo limpia ${deuda.quien}, no lo engorda`);
    }
  }
  // Bajar la deuda no puede romper la suite: quien limpia esos archivos no es
  // dueño de este validador y no podría ajustar el número en el mismo cambio.
  for (const [archivo, deuda] of DEUDA_TEXTO_INCRUSTADO) {
    const vivos = (encontrados.get(archivo) || []).length;
    if (vivos < deuda.max) {
      console.log(`· aviso: ${archivo} ya sólo tiene ${vivos} cadena(s) incrustada(s) (deuda declarada: ${deuda.max}, dueño ${deuda.quien}): baja el número`);
    }
  }
  if (limpio) {
    const pendientes = [...DEUDA_TEXTO_INCRUSTADO].reduce((n, [, d]) => n + d.max, 0);
    console.log(`✓ sin texto incrustado nuevo en los .jsx (deuda conocida y con dueño: ${pendientes} cadenas en ${DEUDA_TEXTO_INCRUSTADO.size} archivos)`);
  }
}

assert.strictEqual(problems, 0, `${problems} problema(s) en las traducciones`);
console.log(`\n=== TODAS LAS PRUEBAS DE TRADUCCIONES PASARON (${langs.length} idiomas × ${baseKeys.length} claves) ===`);
