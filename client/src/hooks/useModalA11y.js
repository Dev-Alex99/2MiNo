import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Trampa de foco, cierre con Escape y aislamiento del resto de la app para
 * cualquier overlay modal.
 *
 * Existe porque la cadena "Escape" no aparecía ni una vez en client/src: los 13
 * overlays del proyecto se abrían sin mover el foco, sin devolverlo al cerrar y
 * sin ciclar el Tab, así que un usuario de teclado quedaba tabulando a ciegas
 * por detrás del diálogo. Un hook único evita que cada modal invente su propia
 * versión a medias.
 *
 * ─── CÓMO SE ENCHUFA (una línea + dos `spread`) ───
 *
 *   const { propsPanel, propsTitulo } = useModalA11y(onClose);
 *
 *   <div className="modal-overlay" onClick={onClose}>
 *     <div className="modal-card modal-a11y" {...propsPanel} onClick={(e) => e.stopPropagation()}>
 *       <h3 className="mi-titulo" {...propsTitulo}>{titulo}</h3>
 *
 * `propsPanel` YA LLEVA la ref (es una ref de callback): hay que esparcirlo, no
 * poner `ref=` a mano. Es lo que permite que funcione un modal como
 * EndGameModal, que devuelve null durante 4,1 s y monta su panel tarde: con una
 * ref normal el efecto se habría ejecutado con `current` todavía a null.
 *
 * Si el modal no tiene título visible, se le pasa uno accesible ya traducido
 * (nunca una clave cruda):
 *   useModalA11y(onClose, { etiqueta: titulo })   // pone aria-label en vez de
 *                                                 // aria-labelledby
 *
 * Y si el componente necesita además el nodo del panel para otra cosa, existe
 * la forma larga con ref propia, que es la del contrato:
 *   const refPanel = useRef(null);
 *   const { propsPanel } = useModalA11y(refPanel, onClose);
 *
 * ─── EL DIÁLOGO QUE NO APAGA LA APP: { aislar: false } ───
 *
 *   useModalA11y(rechazar, { aislar: false, rol: 'alertdialog' })
 *
 * Mueve el foco, cicla el Tab y cierra con Escape igual que siempre, pero NO
 * vuelve `inert` el resto de la pantalla y declara `aria-modal="false"`. Existe
 * para el timbre de la línea: una llamada entrante llega mientras juegas, y un
 * diálogo que apaga el tablero te quita la partida por atender el teléfono.
 * Con `rol` se cambia el papel del panel sin tener que pisar `propsPanel`
 * después de esparcirlo (el timbre es un `alertdialog`, no un `dialog`).
 *
 * ─── QUIÉN LO USA ───
 * Los 12 overlays del proyecto: MoveLog, EndGameModal, FriendsModal,
 * LeaderboardModal, ProfileModal, RankedSearch, ReplayModal, SkinStoreModal,
 * TournamentBracket, TournamentEntry y las dos hojas de TournamentHub (el
 * vestíbulo del torneo y el cuadro), que comparten una sola llamada porque
 * nunca están montadas a la vez.
 */

// Lo que el navegador considera parada de tabulación. El filtro real es
// `tabIndex >= 0`, que resuelve de una vez los tabindex negativos (incluido el
// del título, que recibe el foco pero NO debe ser una parada del ciclo).
const SELECTOR_FOCO = [
  'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea', 'details',
  'iframe', 'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])', '[tabindex]'
].join(',');

// Pila de paneles abiertos. Con dos modales encima, sólo el de arriba responde a
// Escape y al Tab; el de abajo se queda quieto hasta que el otro se cierra.
const pilaDeModales = [];

function paradasDe(panel) {
  const vista = panel.ownerDocument?.defaultView || window;
  return Array.from(panel.querySelectorAll(SELECTOR_FOCO)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[inert],[hidden]')) return false;
    const estilo = vista.getComputedStyle(el);
    return estilo.display !== 'none' && estilo.visibility !== 'hidden';
  });
}

/**
 * Apaga todo lo que no sea el diálogo: sube desde el panel hasta <body>
 * marcando `inert` (y `aria-hidden` para navegadores sin inert) en cada hermano
 * del camino. Sirve igual para un modal por portal que para uno montado dentro
 * del árbol de la app, que es la razón de recorrer ancestros en vez de tocar
 * sólo los hijos de <body>.
 */
function aislarPanel(panel) {
  const doc = panel.ownerDocument || document;
  const tocados = [];
  let nodo = panel;

  while (nodo.parentElement && nodo !== doc.body) {
    const padre = nodo.parentElement;
    for (const hermano of Array.from(padre.children)) {
      // Un hermano ya inerte lo apagó otro modal: es suyo, no lo restauramos.
      if (hermano === nodo || hermano.hasAttribute('inert')) continue;
      if (hermano.tagName === 'SCRIPT' || hermano.tagName === 'STYLE' || hermano.tagName === 'LINK') continue;
      tocados.push([hermano, hermano.getAttribute('aria-hidden')]);
      hermano.setAttribute('inert', '');
      hermano.setAttribute('aria-hidden', 'true');
    }
    nodo = padre;
  }

  return () => {
    for (const [el, ariaPrevio] of tocados) {
      el.removeAttribute('inert');
      if (ariaPrevio === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', ariaPrevio);
    }
  };
}

export default function useModalA11y(refPanel, onClose, opciones = {}) {
  // Forma corta useModalA11y(onClose, opciones) frente a la larga
  // useModalA11y(refPanel, onClose, opciones): se distinguen por el tipo del
  // primer argumento, que en la corta es la función de cierre.
  const formaCorta = typeof refPanel === 'function';
  const cerrar = formaCorta ? refPanel : onClose;
  const refExterna = formaCorta ? null : refPanel;
  const opts = (formaCorta ? onClose : opciones) || {};

  const aislar = opts.aislar !== false;
  const rol = opts.rol || 'dialog';

  const idTitulo = useId();
  const [panel, setPanel] = useState(null);

  // El manejador de teclado se registra una vez por panel, así que tiene que
  // leer el onClose vigente en el momento de la pulsación, no el del render en
  // que se registró.
  const refCerrar = useRef(cerrar);
  refCerrar.current = cerrar;

  const asignarPanel = useCallback((el) => {
    if (refExterna) refExterna.current = el;
    setPanel(el);
  }, [refExterna]);

  // Foco de entrada, aislamiento y devolución del foco al desmontar.
  useEffect(() => {
    if (!panel) return undefined;
    const doc = panel.ownerDocument || document;
    const previo = doc.activeElement;

    pilaDeModales.push(panel);
    // El aislamiento es lo único opcional: la pila, el foco de entrada y la
    // devolución al cerrar valen igual para un diálogo que deja seguir jugando.
    const restaurarAislamiento = aislar ? aislarPanel(panel) : () => {};

    const titulo = panel.querySelector('[data-modal-titulo]');
    const destino = titulo || paradasDe(panel)[0] || panel;
    if (destino && typeof destino.focus === 'function') destino.focus();

    return () => {
      restaurarAislamiento();
      const i = pilaDeModales.indexOf(panel);
      if (i !== -1) pilaDeModales.splice(i, 1);
      // Si quien abrió el modal ya no existe (una ficha que se jugó, un botón de
      // una vista que cambió), no se fuerza nada: el navegador deja el foco en
      // <body> y el siguiente Tab empieza por arriba.
      if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus();
    };
  }, [panel, aislar]);

  // Escape y ciclo de Tab. Van en el documento y no en el panel para que
  // también funcionen si el foco se ha ido fuera (clic en el fondo del overlay).
  useEffect(() => {
    if (!panel) return undefined;
    const doc = panel.ownerDocument || document;

    const alPulsar = (e) => {
      if (pilaDeModales[pilaDeModales.length - 1] !== panel) return;

      if (e.key === 'Escape') {
        if (refCerrar.current) refCerrar.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const paradas = paradasDe(panel);
      if (paradas.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const primero = paradas[0];
      const ultimo = paradas[paradas.length - 1];
      const actual = doc.activeElement;
      const idx = paradas.indexOf(actual);

      if (idx === -1) {
        // El foco está en el título, en el propio panel o fuera del diálogo: no
        // hay «siguiente» que valga, se elige por posición en el documento. Sin
        // esto, un título colocado detrás del último botón dejaría escapar el
        // Tab fuera del modal.
        e.preventDefault();
        if (!panel.contains(actual)) {
          (e.shiftKey ? ultimo : primero).focus();
          return;
        }
        const vecina = e.shiftKey
          ? paradas.slice().reverse().find((p) => actual.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_PRECEDING)
          : paradas.find((p) => actual.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);
        (vecina || (e.shiftKey ? ultimo : primero)).focus();
      } else if (e.shiftKey && idx === 0) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && idx === paradas.length - 1) {
        e.preventDefault();
        primero.focus();
      }
    };

    doc.addEventListener('keydown', alPulsar);
    return () => doc.removeEventListener('keydown', alPulsar);
  }, [panel]);

  return {
    idTitulo,
    propsPanel: {
      ref: asignarPanel,
      role: rol,
      // Un diálogo que no apaga el resto de la pantalla no puede anunciarse
      // como modal: el lector leería «fuera de aquí no hay nada» y sí lo hay.
      'aria-modal': aislar ? 'true' : 'false',
      // El panel es el destino de foco de último recurso (un diálogo sin título
      // ni botones), por eso entra en el orden con -1 y no como parada.
      tabIndex: -1,
      ...(opts.etiqueta ? { 'aria-label': opts.etiqueta } : { 'aria-labelledby': idTitulo })
    },
    propsTitulo: {
      id: idTitulo,
      tabIndex: -1,
      'data-modal-titulo': ''
    }
  };
}
