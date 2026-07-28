/**
 * Formateadores de mensajes del servidor, compartidos por App y la vista de
 * partida (antes estaban duplicados como closures dentro de App.jsx).
 */

// El servidor manda '@opponent' como marcador cuando no quiere filtrar el
// nombre del rival; se traduce aquí, no en el servidor, para respetar el idioma
// de CADA cliente.
export function formatMessage(t, key, params) {
  if (!params) return t(key);
  const p = { ...params };
  for (const k in p) if (p[k] === '@opponent') p[k] = t('srv.opponent');
  return t(key, p);
}

// Un error puede llegar como texto ya montado (validación del cliente) o como
// { key, params } del servidor, que hay que traducir.
export function renderError(t, e) {
  if (typeof e === 'string') return e;
  return e && e.key ? formatMessage(t, e.key, e.params) : '';
}
