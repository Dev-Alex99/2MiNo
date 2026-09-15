import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { colorDeJugador } from './colorDeJugador';

// El CSS se lee como texto plano: vitest no procesa hojas de estilo (importarlo
// devuelve cadena vacía) y aquí solo interesa que los nombres sigan ahí.
const BASE_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'base.css'),
  'utf8',
);

const TOKENS = [
  'var(--jugador-1)',
  'var(--jugador-2)',
  'var(--jugador-3)',
  'var(--jugador-4)',
];

describe('colorDeJugador', () => {
  it('el mismo id devuelve siempre el mismo token', () => {
    // Es la propiedad que sostiene todo lo demás: si el color de una persona
    // cambiara entre la cinta y el anillo de su última ficha, dejaría de ser
    // identidad y pasaría a ser ruido.
    for (const id of ['ana', 'sJk2_9aQzT', 'bot-3', '42']) {
      const primero = colorDeJugador(id);
      expect(colorDeJugador(id)).toBe(primero);
      expect(colorDeJugador(id)).toBe(primero);
    }
  });

  it('nunca devuelve nada que no sea un token de identidad', () => {
    for (let i = 0; i < 200; i++) {
      expect(TOKENS).toContain(colorDeJugador(`jugador-${i}`));
    }
  });

  it('reparte entre los cuatro tonos', () => {
    const vistos = new Set();
    for (let i = 0; i < 40; i++) vistos.add(colorDeJugador(`jugador-${i}`));
    expect([...vistos].sort()).toEqual(TOKENS);
  });

  it('aguanta id vacío, nulo o numérico', () => {
    // Llega el id que haya: en la sala de espera se pasa el nombre y en la mesa
    // el identificador del socket, y ninguno de los dos está garantizado.
    expect(TOKENS).toContain(colorDeJugador(''));
    expect(TOKENS).toContain(colorDeJugador(null));
    expect(TOKENS).toContain(colorDeJugador(undefined));
    expect(TOKENS).toContain(colorDeJugador(7));
  });

  it('los cuatro tokens que devuelve están declarados en base.css', () => {
    // Devolver var(--jugador-5) o que alguien renombre el token dejaría los
    // avatares transparentes otra vez, y sin error en consola.
    for (let n = 1; n <= 4; n++) {
      expect(BASE_CSS).toMatch(new RegExp(`--jugador-${n}\\s*:`));
    }
  });
});
