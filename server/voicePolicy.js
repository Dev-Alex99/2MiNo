// Consentimiento de la voz: UN solo sitio que decide si `de` puede hacer sonar
// el teléfono de `a`.
//
// Existe porque el producto pasa a ofrecer «llama a quien quieras desde
// cualquier sitio». Si un desconocido puede hacer sonar el teléfono de
// cualquiera, eso no es una función de voz: es una herramienta de acoso. El
// freno va en el mismo commit que el acelerador.
//
// Lo consumen `call_friend`, `invite_to_pool` y `friend_challenge`, que hasta
// ahora comprobaban tres cosas distintas y NINGUNO la amistad.
//
// Módulo PURO: no requiere base de datos, ni presencia, ni salas. Todo lo que
// necesita saber del mundo entra por `deps`, para que se pueda probar entero
// sin levantar un servidor y sin tocar Postgres.

// Mínimo entre dos timbres del mismo llamante al mismo destino.
const ENTRE_TIMBRES_MS = 20000;

// Silencio tras un rechazo. Es lo ÚNICO que ataca de verdad el acoso: el cubo
// por socket de security.js se evade abriendo pestañas (hasta 40 por IP).
const TRAS_RECHAZO_MS = 5 * 60 * 1000;

// 'de>a' -> { t, rechazadoEn }
const ultimoTimbre = new Map();

const clave = (de, a) => `${de}>${a}`;

/**
 * ¿Puede `de` llamar a `a`? Devuelve { ok:true } o { ok:false, code }.
 * Los `code` son los del contrato §5.3; el cliente los traduce.
 *
 * deps:
 *   hayPersistencia()      -> boolean
 *   sonAmigos(de, a)       -> boolean | Promise<boolean>
 *   mismaMesa(de, a)       -> boolean
 *   estaEnLinea(a)         -> boolean   (¿tiene algún socket abierto?)
 *   disponibilidadDe(a)    -> 'libre' | 'no_molestar'
 */
async function puedeLlamar(de, a, deps = {}) {
  const {
    hayPersistencia = () => false,
    sonAmigos = () => false,
    mismaMesa = () => false,
    estaEnLinea = () => true,
    disponibilidadDe = () => 'libre',
    ahora = Date.now()
  } = deps;

  if (!de || !a) return { ok: false, code: 'no_existe' };
  if (de === a) return { ok: false, code: 'a_ti_mismo' };

  if (disponibilidadDe(a) === 'no_molestar') return { ok: false, code: 'no_molestar' };

  const enfriando = enfriamiento(de, a, ahora);
  if (enfriando) return { ok: false, code: 'enfriamiento' };

  // ─── LA ASIMETRÍA DE ESTA REGLA ES DELIBERADA ───
  // `db.getFriends` devuelve [] cuando no hay pool de Postgres, que es el
  // estado por defecto de CUALQUIER clon de este repositorio. Un `sonAmigos`
  // ingenuo dejaría la voz entre amigos inutilizable en el modo por defecto:
  // nadie sería amigo de nadie y ninguna llamada saldría jamás, sin un error
  // que explicara por qué.
  //
  // Por eso: SIN persistencia se permite (no hay grafo social que consultar y
  // el servidor es de quien lo levanta); CON persistencia se EXIGE amistad o
  // mesa compartida. Quien «arregle» esto igualando los dos casos rompe el
  // modo por defecto — y quien lo relaje en el caso con persistencia abre la
  // puerta al acoso que este archivo existe para cerrar.
  if (hayPersistencia()) {
    const amigos = await sonAmigos(de, a);
    if (!amigos && !mismaMesa(de, a)) return { ok: false, code: 'no_amigos' };
  }

  if (!estaEnLinea(a)) return { ok: false, code: 'desconectado' };

  return { ok: true };
}

/** ¿Está `de` en enfriamiento respecto de `a`? Devuelve el motivo o null. */
function enfriamiento(de, a, ahora = Date.now()) {
  const reg = ultimoTimbre.get(clave(de, a));
  if (!reg) return null;
  if (reg.rechazadoEn && ahora - reg.rechazadoEn < TRAS_RECHAZO_MS) return 'rechazo';
  if (reg.t && ahora - reg.t < ENTRE_TIMBRES_MS) return 'seguido';
  return null;
}

/** Se ha hecho sonar el teléfono de `a`. */
function registrarTimbre(de, a, ahora = Date.now()) {
  const k = clave(de, a);
  const reg = ultimoTimbre.get(k) || {};
  reg.t = ahora;
  ultimoTimbre.set(k, reg);

  // El enfriamiento se CANCELA si quien rechazó devuelve la llamada. Es la
  // regla socialmente correcta: sin ella, dos amigos que se rechazaron sin
  // querer se topan con un bug con forma de política durante cinco minutos.
  const inverso = ultimoTimbre.get(clave(a, de));
  if (inverso && inverso.rechazadoEn) inverso.rechazadoEn = null;
}

/** `a` ha rechazado la llamada de `de`: cinco minutos de silencio. */
function registrarRechazo(de, a, ahora = Date.now()) {
  const k = clave(de, a);
  const reg = ultimoTimbre.get(k) || {};
  reg.rechazadoEn = ahora;
  ultimoTimbre.set(k, reg);
}

/** Limpieza oportunista: el mapa no debe crecer sin techo en un proceso largo. */
function podar(ahora = Date.now()) {
  if (ultimoTimbre.size < 5000) return;
  for (const [k, reg] of ultimoTimbre) {
    const vivoPorTimbre = reg.t && ahora - reg.t < ENTRE_TIMBRES_MS;
    const vivoPorRechazo = reg.rechazadoEn && ahora - reg.rechazadoEn < TRAS_RECHAZO_MS;
    if (!vivoPorTimbre && !vivoPorRechazo) ultimoTimbre.delete(k);
  }
}

function _reset() {
  ultimoTimbre.clear();
}

module.exports = {
  ENTRE_TIMBRES_MS,
  TRAS_RECHAZO_MS,
  puedeLlamar,
  enfriamiento,
  registrarTimbre,
  registrarRechazo,
  podar,
  _reset
};
