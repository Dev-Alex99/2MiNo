import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CintaTurno from './CintaTurno';
import { VoiceProvider } from '../voice/VoiceContext';
import { render, resetStores } from '../test/utils';

const MESA = [
  { id: 'p_test', name: 'Yo', handCount: 7, powersCount: 1, score: 0, isBot: false },
  { id: 'p_ana', name: 'Ana', handCount: 4, powersCount: 0, score: 0, isBot: true, difficulty: 'normal' },
  { id: 'p_bruno', name: 'Bruno', handCount: 5, powersCount: 2, score: 0, isBot: true, difficulty: 'dificil' },
  { id: 'p_carla', name: 'Carla', handCount: 6, powersCount: 3, score: 0, isBot: true, difficulty: 'facil' }
];

function pintar(extra = {}) {
  const props = {
    players: MESA,
    playerId: 'p_test',
    currentPlayerId: 'p_test',
    teamsEnabled: false,
    powersEnabled: true,
    pendingTargetType: null,
    onSelectPlayerTarget: () => {},
    quickNotifications: [],
    ...extra
  };
  return render(<CintaTurno {...props} />);
}

const chips = () => Array.from(document.querySelectorAll('.cinta-chip'));
const etiquetas = () => chips().map(c => c.getAttribute('aria-label'));

describe('CintaTurno', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('pinta un chip por jugador con 2, 3 y 4 en la mesa', () => {
    for (const n of [2, 3, 4]) {
      const { unmount } = pintar({ players: MESA.slice(0, n) });
      expect(chips()).toHaveLength(n);
      // El ancho de 1 contra 1 lo decide el CSS a partir de este atributo.
      expect(document.querySelector('.cinta').getAttribute('data-chips')).toBe(String(n));
      unmount();
    }
  });

  /**
   * Los asientos solo dibujaban rivales: el jugador no tenía sitio propio en la
   * mesa. Aquí su chip es el primero SIEMPRE, sea cual sea su posición en el
   * reparto del servidor.
   */
  it('mi chip es el primero y el orden de juego se conserva', () => {
    pintar({ playerId: 'p_bruno', currentPlayerId: 'p_ana' });
    expect(etiquetas()[0]).toMatch(/^Bruno,/);
    // Rotación, no reordenación: después de Bruno sigue jugando Carla, y luego
    // se vuelve al principio de la lista.
    expect(etiquetas().map(e => e.split(',')[0])).toEqual(['Bruno', 'Carla', 'Yo', 'Ana']);
  });

  /** Tres regiones vivas en toda la partida: la cinta aporta exactamente una. */
  it('declara una sola región role="status" y dice de quién es el turno', () => {
    pintar({ currentPlayerId: 'p_test' });
    const estados = screen.getAllByRole('status');
    expect(estados).toHaveLength(1);
    expect(estados[0].textContent).toBe('Tu turno');
  });

  it('la región de turno nombra al rival cuando no es mi turno', () => {
    pintar({ currentPlayerId: 'p_ana' });
    expect(screen.getByRole('status').textContent).toMatch(/^Ana,/);
  });

  /**
   * El chip entero se anuncia de una vez: nombre, fichas y cartas de poder. Los
   * asientos dejaban el detalle en `title`, que en táctil no existe.
   */
  it('cada chip lleva su etiqueta completa, con los fallos y el turno', () => {
    pintar({
      currentPlayerId: 'p_ana',
      playerPassedOn: { p_ana: [5, 3, 5] }
    });
    const etiqueta = etiquetas().find(e => e.startsWith('Ana'));
    expect(etiqueta).toContain('4 fichas');
    expect(etiqueta).toContain('0 cartas de poder');
    // Ordenados y sin repetir: el servidor apunta un pase por cada extremo.
    expect(etiqueta).toContain('ha fallado 3, 5');
    expect(etiqueta).toContain('jugando ahora');
    // Y quien no juega no dice que está jugando.
    expect(etiquetas().find(e => e.startsWith('Yo'))).not.toContain('jugando ahora');
  });

  it('sin dato de pases no se pinta la fila de fallos ni se anuncia', () => {
    pintar({ currentPlayerId: 'p_ana' });
    expect(document.querySelector('.cinta-fallos')).toBeNull();
    expect(etiquetas().join(' ')).not.toContain('ha fallado');
  });

  it('la fila de fallos pinta tres números y resume el resto', () => {
    pintar({ playerPassedOn: { p_ana: [1, 2, 3, 4, 6] } });
    const marcas = Array.from(document.querySelectorAll('.cinta-fallo')).map(n => n.textContent);
    expect(marcas).toEqual(['1', '2', '3']);
    expect(document.querySelector('.cinta-fallo-mas').textContent).toBe('+2');
    // Visualmente se resume, pero la etiqueta enumera todos.
    expect(etiquetas().find(e => e.startsWith('Ana'))).toContain('ha fallado 1, 2, 3, 4, 6');
  });

  /**
   * `pointer-events:none` en el asiento con `.targetable` como única excepción
   * es hoy el único camino por el que las cinco rutas de poderes llegan a su
   * manejador. Un chip pulsable por defecto rompería ese par en silencio.
   */
  it('fuera de la selección de poderes el chip no es un botón', () => {
    pintar();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    for (const chip of chips()) {
      expect(chip.getAttribute('role')).toBe('group');
      expect(chip.hasAttribute('tabindex')).toBe(false);
    }
  });

  it('con un poder apuntando a jugador, los rivales son botones y yo no', async () => {
    const usuario = userEvent.setup();
    const elegidos = [];
    pintar({
      pendingTargetType: 'player_target',
      onSelectPlayerTarget: (id) => elegidos.push(id)
    });

    const botones = screen.getAllByRole('button');
    expect(botones).toHaveLength(3);
    expect(botones.map(b => b.getAttribute('aria-label').split(',')[0]))
      .toEqual(['Ana', 'Bruno', 'Carla']);
    // Nadie se apunta a sí mismo: con los asientos era imposible porque el
    // jugador no tenía asiento.
    expect(chips()[0].getAttribute('role')).toBe('group');

    await usuario.click(botones[0]);
    expect(elegidos).toEqual(['p_ana']);
  });

  it('el chip objetivo también se activa con teclado', async () => {
    const usuario = userEvent.setup();
    const elegidos = [];
    pintar({
      pendingTargetType: 'smuggle_select_player',
      onSelectPlayerTarget: (id) => elegidos.push(id)
    });

    screen.getAllByRole('button')[1].focus();
    await usuario.keyboard('{Enter}');
    expect(elegidos).toEqual(['p_bruno']);
  });

  /**
   * El estado lo cuenta la etiqueta del grupo; los iconos son redundancia
   * visual. Si además se anunciaran, el chip se leería dos veces.
   */
  it('escudo, corona, blitz y siluetas quedan fuera del árbol accesible', () => {
    pintar({
      players: MESA.map(p => (p.id === 'p_ana' ? { ...p, shieldActive: true, score: 40 } : p)),
      blitzTimeRemaining: { p_ana: 8 }
    });

    for (const sel of ['.cinta-escudo', '.cinta-corona', '.cinta-fichas']) {
      const nodo = document.querySelector(sel);
      expect(nodo, sel).not.toBeNull();
      expect(nodo.getAttribute('aria-hidden'), sel).toBe('true');
    }
    // El blitz vive dentro de la fila de fichas, que ya está oculta.
    expect(document.querySelector('.cinta-fichas .cinta-blitz')).not.toBeNull();
    expect(document.querySelector('.cinta-blitz').textContent).toContain('8');
  });

  it('el medidor de nivel marca una muesca viva por escalón, y sólo en los bots', () => {
    pintar();
    // Tres bots en la mesa (Ana normal, Bruno difícil, Carla fácil) y una
    // persona. El medidor es una promesa sobre cómo juega el rival, así que
    // sobre un humano no significaría nada.
    const medidores = document.querySelectorAll('.cinta-nivel');
    expect(medidores).toHaveLength(3);
    const vivas = [...medidores].map(m => m.querySelectorAll('.cinta-muesca-viva').length);
    expect(vivas).toEqual([2, 3, 1]);
    // Siempre cuatro muescas dibujadas: las apagadas son las que dejan ver que
    // el nivel podría subir. Y el medidor es decorativo, la etiqueta lo dice.
    medidores.forEach(m => {
      expect(m.querySelectorAll('i')).toHaveLength(4);
      expect(m.getAttribute('aria-hidden')).toBe('true');
    });
    expect(etiquetas().join(' ')).toContain('nivel');
  });

  it('en parejas cada chip lleva canto de equipo y glifo', () => {
    pintar({
      teamsEnabled: true,
      players: MESA.map((p, i) => ({ ...p, team: i % 2 }))
    });
    expect(document.querySelectorAll('.cinta-chip-equipo-0')).toHaveLength(2);
    expect(document.querySelectorAll('.cinta-chip-equipo-1')).toHaveLength(2);
    // El color solo no basta: la cinta ordena por turno y el compañero no queda
    // enfrente como en una mesa física.
    expect(Array.from(document.querySelectorAll('.cinta-glifo-equipo')).map(g => g.textContent))
      .toEqual(['◆', '●', '◆', '●']);
  });

  it('el espectador ve a todos y no tiene chip propio ni objetivos', () => {
    // Con playerId puesto a propósito: quien espectra sigue teniendo el suyo en
    // el store, y aun así no le corresponde ningún chip de esta mesa.
    pintar({
      esEspectador: true,
      playerId: 'p_bruno',
      pendingTargetType: 'player_target',
      currentPlayerId: 'p_carla'
    });
    expect(chips()).toHaveLength(4);
    expect(document.querySelector('.cinta-chip-yo')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(etiquetas()[0]).toMatch(/^Yo,/);
  });
});

describe('CintaTurno · el reloj', () => {
  afterEach(() => { vi.useRealTimers(); });

  function conReloj(msRestantes, extra = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    return pintar({
      turnEndsAt: Date.now() + msRestantes,
      turnSecondsRemaining: Math.round(msRestantes / 1000),
      turnDurationSeconds: 30,
      ...extra
    });
  }

  const avisos = () => screen.queryAllByRole('alert');
  const avanzar = (ms) => act(() => { vi.advanceTimersByTime(ms); });

  it('drena el canto del chip activo con una sola escritura de estilo', () => {
    conReloj(15000);
    const drenaje = document.querySelector('.cinta-chip-activo .cinta-reloj-drenaje');
    expect(drenaje).not.toBeNull();
    // Media duración consumida: la transición dura lo que queda y termina en 0.
    expect(drenaje.style.transition).toBe('transform 15000ms linear');
    expect(drenaje.style.transform).toBe('scaleY(0)');
    // Y solo el chip del turno tiene drenaje.
    expect(document.querySelectorAll('.cinta-reloj-drenaje')).toHaveLength(1);
  });

  /** El servidor juega por ti al llegar a cero y hoy no hay ningún preaviso. */
  it('avisa a 10 y a 5 segundos, una sola vez por umbral y ninguna antes', () => {
    conReloj(30000);
    expect(avisos()).toHaveLength(0);

    avanzar(20000); // quedan 10
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0].textContent).toMatch(/Quedan 10 segundos/);

    avanzar(2000); // quedan 8: el aviso NO se repite cada segundo
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0].textContent).toMatch(/Quedan 10 segundos/);

    avanzar(3000); // quedan 5
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0].textContent).toMatch(/Quedan 5 segundos/);

    avanzar(8000); // se acaba el turno: no hay un tercer aviso
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0].textContent).toMatch(/Quedan 5 segundos/);
  });

  it('el color y el grosor del canto escalan con el aviso', () => {
    conReloj(30000);
    const banda = document.querySelector('.cinta');
    expect(banda.className).not.toMatch(/cinta-tramo/);

    avanzar(20000);
    expect(banda.className).toMatch(/cinta-tramo-aviso/);

    avanzar(5000);
    expect(banda.className).toMatch(/cinta-tramo-critico/);
  });

  /** El reloj de un rival es un drenaje silencioso: no me interrumpe. */
  it('no avisa cuando el turno es de otro', () => {
    conReloj(30000, { currentPlayerId: 'p_ana' });
    avanzar(29000);
    expect(avisos()).toHaveLength(0);
    expect(document.querySelector('.cinta').className).not.toMatch(/cinta-tramo/);
    // Pero el canto del rival sí drena.
    expect(document.querySelectorAll('.cinta-reloj-drenaje')).toHaveLength(1);
  });

  /** Al reconectar, el turno puede empezar ya por debajo del umbral. */
  it('si el turno arranca con 4 segundos, avisa del tramo crítico y solo de ese', () => {
    conReloj(4000);
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0].textContent).toMatch(/Quedan 5 segundos/);
  });

  it('el numeral es visual: no se anuncia', () => {
    conReloj(12000);
    const numeral = document.querySelector('.cinta-reloj-numeral');
    expect(numeral.textContent).toBe('12');
    expect(numeral.getAttribute('aria-hidden')).toBe('true');

    avanzar(3000);
    expect(document.querySelector('.cinta-reloj-numeral').textContent).toBe('9');
  });

  it('sin datos de reloj la cinta se pinta igual, sin canto ni avisos', () => {
    pintar();
    expect(document.querySelector('.cinta-reloj-drenaje')).toBeNull();
    expect(document.querySelector('.cinta-reloj-numeral')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(chips()).toHaveLength(4);
  });
});

/**
 * EL MICRO DE LA CINTA, QUE HASTA AHORA NO SE ENCENDÍA NUNCA.
 *
 * `player.inVoice` sólo se activaba con `voice_join`, un evento que ningún
 * cliente emitía desde que se desmanteló la interfaz de voz: era constante
 * `false`, así que el glifo de 10 px del chip era código muerto. Ahora sale de
 * `table_voice`, que el servidor manda A LA SALA y YA ALIASADO — dentro de una
 * sala `player.id` ES el alias de asiento, y ése es el índice.
 */
describe('CintaTurno · quién está en la voz de la mesa', () => {
  beforeEach(() => resetStores());

  const conVoz = (props = {}) => render(
    <VoiceProvider>
      <CintaTurno
        players={MESA}
        playerId="p_test"
        currentPlayerId="p_test"
        powersEnabled
        quickNotifications={[]}
        onSelectPlayerTarget={() => {}}
        {...props}
      />
    </VoiceProvider>
  );

  const chipDe = (nombre) => chips().find(c => (c.getAttribute('aria-label') || '').startsWith(nombre));

  it('sin table_voice no hay ni un micro encendido', () => {
    conVoz();
    expect(document.querySelectorAll('.cinta-micro')).toHaveLength(0);
  });

  it('un table_voice con el alias de Ana enciende SU micro y sólo el suyo', () => {
    conVoz();
    act(() => globalThis.__socket.recibir('table_voice', {
      roomId: 'ABCD', alias: ['p_ana'], n: 1
    }));

    expect(document.querySelectorAll('.cinta-micro')).toHaveLength(1);
    expect(chipDe('Ana').querySelector('.cinta-micro')).not.toBeNull();
    expect(chipDe('Yo').querySelector('.cinta-micro')).toBeNull();
    // Y se DICE, no sólo se pinta: un glifo de 10 px no lo lee nadie con lector.
    expect(chipDe('Ana').getAttribute('aria-label')).toContain('En una llamada');
  });

  /**
   * Hablar se marca con DOS canales: el anillo verde del chip y el glifo del
   * micro convertido en un medidor de tres barras. Con el anillo solo, un
   * daltónico y una captura en blanco y negro se quedan sin la señal.
   */
  it('hablar cambia el micro por un medidor y enciende el anillo', () => {
    conVoz();
    act(() => globalThis.__socket.recibir('table_voice', {
      roomId: 'ABCD', alias: ['p_ana'], n: 1
    }));
    act(() => globalThis.__socket.recibir('table_speaking', {
      roomId: 'ABCD', alias: ['p_ana'], speaking: true
    }));

    const chip = chipDe('Ana');
    expect(chip.className).toMatch(/cinta-chip-voz/);
    expect(chip.querySelector('.linea-barras-mesa')).not.toBeNull();
    expect(chip.querySelector('.cinta-micro')).toBeNull();

    act(() => globalThis.__socket.recibir('table_speaking', {
      roomId: 'ABCD', alias: ['p_ana'], speaking: false
    }));
    expect(chipDe('Ana').className).not.toMatch(/cinta-chip-voz/);
    expect(chipDe('Ana').querySelector('.cinta-micro')).not.toBeNull();
  });

  /** `table_speaking.alias` viaja como ARRAY de un elemento: todo lo que va a
   *  una sala pasa por `emitirAMesa()`, que produce un array. */
  it('el alias llega dentro de un array y aun así casa con el asiento', () => {
    conVoz();
    act(() => globalThis.__socket.recibir('table_voice', {
      roomId: 'ABCD', alias: ['p_bruno', 'p_carla'], n: 2
    }));
    expect(document.querySelectorAll('.cinta-micro')).toHaveLength(2);
  });
});
