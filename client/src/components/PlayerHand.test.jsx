import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../test/utils';
import PlayerHand from './PlayerHand';
import { ladosJugables, contarJugables } from '../games/domino/jugadas';

// Mano de referencia con los tres casos a la vez, y ya ordenada por puntos
// (12, 7, 1) para que el orden de pantalla coincida con el de la prop y los
// índices del test se lean sin traducción mental:
//   [6,6] encaja SOLO por la izquierda (extremo 6)
//   [3,4] encaja SOLO por la derecha   (extremo 4)
//   [0,1] no encaja por ningún lado
const MANO = [[6, 6], [3, 4], [0, 1]];

function montar(extra = {}) {
  const props = {
    hand: MANO,
    isMyTurn: true,
    selectedTileIndex: null,
    setSelectedTileIndex: vi.fn(),
    leftEnd: 6,
    rightEnd: 4,
    onPlay: vi.fn(),
    boardIsEmpty: false,
    onTileClickOverride: null,
    wildcardActive: false,
    ...extra
  };
  const utils = render(<PlayerHand {...props} />);
  return { ...utils, props };
}

/** Los botones de ficha, sin el control de ordenación, que vive fuera del grupo. */
function fichas() {
  return within(screen.getByRole('group', { name: 'Tu mano' })).getAllByRole('button');
}

describe('PlayerHand', () => {
  it('cada ficha tiene nombre accesible con su encaje', () => {
    montar();
    const etiquetas = fichas().map(b => b.getAttribute('aria-label'));
    expect(etiquetas).toEqual([
      'doble 6, encaja por el extremo izquierdo',
      'ficha 3 y 4, encaja por el extremo derecho',
      'ficha 0 y 1, no encaja'
    ]);
  });

  it('fuera de turno el nombre NO lleva sufijo de encaje', () => {
    montar({ isMyTurn: false });
    const etiquetas = fichas().map(b => b.getAttribute('aria-label'));
    expect(etiquetas).toEqual(['doble 6', 'ficha 3 y 4', 'ficha 0 y 1']);
  });

  it('la posición viaja en aria-posinset/aria-setsize, no en el texto', () => {
    montar();
    const b = fichas();
    expect(b.map(x => x.getAttribute('aria-posinset'))).toEqual(['1', '2', '3']);
    expect(b.every(x => x.getAttribute('aria-setsize') === '3')).toBe(true);
    expect(b.some(x => /3 de 3|3 of 3/.test(x.getAttribute('aria-label')))).toBe(false);
  });

  it('ninguna ficha usa el atributo disabled; la no jugable va con aria-disabled', () => {
    const { container } = montar();
    expect(container.querySelector('[disabled]')).toBeNull();
    const b = fichas();
    expect(b[0]).not.toHaveAttribute('aria-disabled');
    expect(b[2]).toHaveAttribute('aria-disabled', 'true');
  });

  it('la mano es UNA sola parada de tabulación', () => {
    montar();
    const b = fichas();
    expect(b.map(x => x.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('la flecha derecha mueve el foco a la siguiente ficha', () => {
    montar();
    const b = fichas();
    b[0].focus();
    fireEvent.keyDown(b[0], { key: 'ArrowRight' });

    expect(document.activeElement).toBe(fichas()[1]);
    expect(fichas().map(x => x.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('la flecha izquierda no se sale por el principio y Fin va al final', () => {
    montar();
    const b = fichas();
    b[0].focus();
    fireEvent.keyDown(b[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(fichas()[0]);

    fireEvent.keyDown(fichas()[0], { key: 'End' });
    expect(document.activeElement).toBe(fichas()[2]);

    fireEvent.keyDown(fichas()[2], { key: 'Home' });
    expect(document.activeElement).toBe(fichas()[0]);
  });

  it('Enter sobre una ficha de encaje único la juega por ese lado', () => {
    const { props } = montar();
    fireEvent.keyDown(fichas()[0], { key: 'Enter' });
    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect(props.onPlay).toHaveBeenCalledWith(0, 'left');

    fireEvent.keyDown(fichas()[1], { key: ' ' });
    expect(props.onPlay).toHaveBeenCalledWith(1, 'right');
  });

  it('con teclado de verdad la ficha se juega UNA vez, no dos', async () => {
    // La ficha es un <button>: Enter y Espacio disparan además su activación
    // nativa. Si el manejador no la corta, la jugada sale por duplicado.
    const usuario = userEvent.setup();
    const { props } = montar();
    fichas()[0].focus();
    await usuario.keyboard('{Enter}');
    expect(props.onPlay).toHaveBeenCalledTimes(1);

    props.onPlay.mockClear();
    fichas()[1].focus();
    await usuario.keyboard(' ');
    expect(props.onPlay).toHaveBeenCalledTimes(1);
  });

  it('la ficha que no encaja no juega ni con clic ni con Enter', () => {
    const { props } = montar();
    fireEvent.click(fichas()[2]);
    fireEvent.keyDown(fichas()[2], { key: 'Enter' });
    expect(props.onPlay).not.toHaveBeenCalled();
    expect(props.setSelectedTileIndex).not.toHaveBeenCalled();
  });

  it('la ficha que encaja por los dos lados se elige en vez de jugarse', () => {
    const { props } = montar({ hand: [[6, 4]], leftEnd: 6, rightEnd: 4 });
    fireEvent.click(fichas()[0]);
    expect(props.onPlay).not.toHaveBeenCalled();
    expect(props.setSelectedTileIndex).toHaveBeenCalledWith(0);
  });

  it('con ficha elegida, las flechas juegan a ese extremo sin mover el foco', () => {
    const { props } = montar({ hand: [[6, 4], [0, 1]], selectedTileIndex: 0, leftEnd: 6, rightEnd: 4 });
    const b = fichas();
    b[0].focus();

    fireEvent.keyDown(b[0], { key: 'ArrowRight' });
    expect(props.onPlay).toHaveBeenCalledWith(0, 'right');
    // El foco NO se ha ido a la ficha siguiente.
    expect(document.activeElement).toBe(fichas()[0]);
  });

  it('Escape cancela la ficha elegida', () => {
    const { props } = montar({ hand: [[6, 4]], selectedTileIndex: 0 });
    fireEvent.keyDown(fichas()[0], { key: 'Escape' });
    expect(props.setSelectedTileIndex).toHaveBeenCalledWith(null);
  });

  it('los tres estados van en tres clases distintas', () => {
    montar({ selectedTileIndex: 1 });
    const b = fichas();
    expect(b[0].className).toContain('es-jugable');
    expect(b[1].className).toContain('esta-elegida');
    expect(b[2].className).toContain('no-jugable');
    // Nunca dos estados a la vez: cada canal tiene que poder leerse solo.
    for (const x of b) {
      const estados = ['es-jugable', 'no-jugable', 'esta-elegida'].filter(c => x.classList.contains(c));
      expect(estados).toHaveLength(1);
    }
  });

  it('fuera de turno ninguna ficha se marca como no jugable', () => {
    montar({ isMyTurn: false });
    for (const x of fichas()) {
      expect(x.classList.contains('no-jugable')).toBe(false);
      expect(x.classList.contains('es-jugable')).toBe(false);
    }
  });

  it('los pips 6-9 pasan por el token de la skin, no por un color fijo', () => {
    const { container } = montar({ hand: [[6, 3]] });
    const rejillas = container.querySelectorAll('.pip-grid');
    // Mitad de valor 6: token; mitad de valor 3: sin variable, cae a --tile-pip.
    expect(rejillas[0].style.getPropertyValue('--pip-color')).toBe('var(--pip-6)');
    expect(rejillas[1].style.getPropertyValue('--pip-color')).toBe('');
    // Y ningún pip lleva ya un background inline que pisaría la skin.
    for (const pip of container.querySelectorAll('.pip')) {
      expect(pip.style.background).toBe('');
    }
  });

  it('tras jugar con el teclado el foco vuelve a la mano, no al <body>', () => {
    const { rerender, props } = montar();
    fichas()[0].focus();
    fireEvent.keyDown(fichas()[0], { key: 'Enter' });
    // El padre responde con la mano ya sin esa ficha; su botón se desmonta.
    rerender(<PlayerHand {...props} hand={[[3, 4], [0, 1]]} />);

    expect(document.activeElement).not.toBe(document.body);
    expect(fichas()).toContain(document.activeElement);
  });

  it('sin foco dentro de la mano, cambiar de mano NO roba el foco', () => {
    const { rerender, props } = montar();
    const fuera = document.createElement('button');
    document.body.appendChild(fuera);
    fuera.focus();

    rerender(<PlayerHand {...props} hand={[[3, 4], [0, 1]]} />);
    expect(document.activeElement).toBe(fuera);
    fuera.remove();
  });

  it('la clave de React es la ficha física: al jugar una, las demás no se remontan', () => {
    const { rerender, props } = montar();
    const antes = fichas()[1];

    rerender(<PlayerHand {...props} hand={[[3, 4], [0, 1]]} />);

    // Mismo nodo del DOM: con la clave `${a}-${b}-${index}` de antes, quitar la
    // primera ficha remontaba todas las siguientes y les relanzaba la animación.
    expect(fichas()[0]).toBe(antes);
  });

  it('el control de ordenación reordena y se recuerda', () => {
    // Por palo: 0-1, 3-4, 6-6. Por puntos (defecto): 6-6, 3-4, 0-1.
    const { props } = montar();
    expect(fichas().map(b => b.getAttribute('aria-label'))[0]).toContain('doble 6');

    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por palo' }));

    expect(fichas().map(b => b.getAttribute('aria-label'))).toEqual([
      'ficha 0 y 1, no encaja',
      'ficha 3 y 4, encaja por el extremo derecho',
      'doble 6, encaja por el extremo izquierdo'
    ]);
    expect(localStorage.getItem('domino_mano_orden')).toBe('palo');

    // El orden es de pantalla: el índice que viaja a onPlay sigue siendo el de
    // la mano del servidor.
    fireEvent.keyDown(fichas()[2], { key: 'Enter' });
    expect(props.onPlay).toHaveBeenCalledWith(0, 'left');
  });

  it('mientras un poder pide elegir ficha, cualquier ficha vale', () => {
    const onTileClickOverride = vi.fn();
    const { props } = montar({ onTileClickOverride });
    fireEvent.click(fichas()[2]);            // la que no encaja
    expect(onTileClickOverride).toHaveBeenCalledWith(2, [0, 1]);
    expect(props.onPlay).not.toHaveBeenCalled();
    expect(fichas()[2]).not.toHaveAttribute('aria-disabled');
  });

  it('sin jugadas y con pozo, muestra botón de robar y dispara onDraw', () => {
    const onDraw = vi.fn();
    montar({ hand: [[0, 1]], leftEnd: 6, rightEnd: 4, boneyardCount: 3, onDraw });
    const btn = screen.getByRole('button', { name: /robar/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onDraw).toHaveBeenCalledTimes(1);
  });

  it('sin jugadas y sin pozo, muestra botón de pasar y dispara onPass', () => {
    const onPass = vi.fn();
    montar({ hand: [[0, 1]], leftEnd: 6, rightEnd: 4, boneyardCount: 0, onPass });
    const btn = screen.getByRole('button', { name: /pasar/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onPass).toHaveBeenCalledTimes(1);
  });

  it('con ficha elegida muestra aviso y botón de cancelar selección', () => {
    const setSelectedTileIndex = vi.fn();
    montar({ hand: [[6, 4]], selectedTileIndex: 0, leftEnd: 6, rightEnd: 4, setSelectedTileIndex });
    const btnCancel = screen.getByRole('button', { name: /cancelar/i });
    expect(btnCancel).toBeInTheDocument();
    fireEvent.click(btnCancel);
    expect(setSelectedTileIndex).toHaveBeenCalledWith(null);
  });

  it('doble clic sobre ficha jugable la juega de inmediato', () => {
    const onPlay = vi.fn();
    montar({ hand: [[6, 6]], leftEnd: 6, rightEnd: 4, onPlay });
    fireEvent.doubleClick(fichas()[0]);
    expect(onPlay).toHaveBeenCalledWith(0, 'left');
  });

  it('no revienta con la mano vacía', () => {
    expect(() => montar({ hand: [] })).not.toThrow();
    expect(fichas.bind(null)).toThrow(); // no hay botones: el grupo está vacío
  });
});

describe('jugadas · ladosJugables', () => {
  const ctx = { isMyTurn: true, leftEnd: 6, rightEnd: 4 };

  it('fuera de turno no encaja nada', () => {
    expect(ladosJugables([6, 6], { ...ctx, isMyTurn: false })).toEqual({ left: false, right: false });
  });

  it('compara los dos valores de la ficha contra los dos extremos', () => {
    expect(ladosJugables([6, 0], ctx)).toEqual({ left: true, right: false });
    expect(ladosJugables([0, 4], ctx)).toEqual({ left: false, right: true });
    expect(ladosJugables([6, 4], ctx)).toEqual({ left: true, right: true });
    expect(ladosJugables([1, 2], ctx)).toEqual({ left: false, right: false });
  });

  it('con el tablero vacío entra cualquier ficha', () => {
    expect(ladosJugables([1, 2], { isMyTurn: true, boardIsEmpty: true })).toEqual({ left: true, right: true });
  });

  it('con comodín entra por cualquier extremo que exista', () => {
    expect(ladosJugables([1, 2], { ...ctx, wildcardActive: true })).toEqual({ left: true, right: true });
    // Con la mesa vacía solo hay un sitio donde abrir.
    expect(ladosJugables([1, 2], { isMyTurn: true, wildcardActive: true, boardIsEmpty: true }))
      .toEqual({ left: true, right: false });
  });

  it('una ficha malformada no encaja en vez de reventar', () => {
    expect(ladosJugables(undefined, ctx)).toEqual({ left: false, right: false });
    expect(ladosJugables([3], ctx)).toEqual({ left: false, right: false });
  });
});

describe('jugadas · contarJugables', () => {
  it('cuenta fichas, no lados: la que encaja por los dos suma 1', () => {
    expect(contarJugables(MANO, { isMyTurn: true, leftEnd: 6, rightEnd: 4 })).toBe(2);
    expect(contarJugables([[6, 4]], { isMyTurn: true, leftEnd: 6, rightEnd: 4 })).toBe(1);
  });

  it('sin mano o fuera de turno devuelve 0', () => {
    expect(contarJugables(undefined, { isMyTurn: true })).toBe(0);
    expect(contarJugables(MANO, { isMyTurn: false, leftEnd: 6, rightEnd: 4 })).toBe(0);
  });
});
