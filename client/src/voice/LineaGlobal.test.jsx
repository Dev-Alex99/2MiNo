import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineaGlobal from './LineaGlobal';
import LineaCapsula, { useHoja } from './LineaCapsula';
import { VoiceProvider } from './VoiceContext';
import { useLineaStore } from './useLineaStore';
import { render, resetStores, setGameStore, partidaDePrueba } from '../test/utils';

const socket = globalThis.__socket;

/**
 * LA SUPERFICIE DE LA VOZ.
 *
 * Estos casos cubren los dos defectos que el encargo nombra por su nombre:
 *
 * · EL TIMBRE SE PINTABA HASTA TRES VECES, con tres botones de «Aceptar»
 *   distintos, porque las ramas de entrante y saliente de `UnifiedVoiceWidget`
 *   iban ANTES que sus filtros por `variant` y había tres instancias vivas a la
 *   vez (App + GameBar + el tablero de tres en raya). Aquí se monta el nodo
 *   global CON tres cápsulas al lado y se exige UNA sola tarjeta.
 *
 * · DENTRO DE LA PARTIDA LA VOZ NO TENÍA SUPERFICIE: el único nodo que quedaba
 *   —`.unified-voice-embedded-idle`— lo escondía `perfil-hub.css:2090` con
 *   `display:none`. Aquí la cápsula anclada es un botón REAL que entra en la
 *   voz de la mesa, y se comprueba que emite.
 *
 * Y conserva la REGRESIÓN A-4 (ningún `return` condicional por encima de un
 * hook), que ya se coló dos veces en este proyecto y que hasta ahora vivía en
 * `UnifiedVoiceWidget.test.jsx`, borrado con su componente.
 */

const TIMBRE = {
  callId: 'c1',
  fromPlayerId: 'p_amiga',
  fromName: 'Marta',
  tipo: 'directa',
  expiraEn: Date.now() + 30000
};

function reiniciar() {
  resetStores();
  useHoja.setState({ abierta: false });
}

/** El marco mínimo: el proveedor (que arranca el motor) y el nodo global. */
function pintarLinea(extra = null) {
  return render(
    <VoiceProvider>
      <LineaGlobal />
      {extra}
    </VoiceProvider>
  );
}

const timbres = () => document.querySelectorAll('.linea-timbre');
const contestar = () => screen.queryAllByRole('button', { name: 'Contestar' });

describe('LineaGlobal · orden de hooks (regresión A-4)', () => {
  beforeEach(reiniciar);

  it('fuera del proveedor de voz no pinta nada, sin romper', () => {
    const { container } = render(<LineaGlobal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('pasar de FUERA a DENTRO del proveedor no rompe el orden de hooks', () => {
    // La misma posición del árbol: React conserva la instancia y sólo cambia el
    // valor del contexto. Con un `return` por encima de los hooks, este
    // rerender lanzaba «Rendered fewer hooks than expected».
    function Envoltorio({ conProveedor }) {
      const nodo = <LineaGlobal />;
      return conProveedor ? <VoiceProvider>{nodo}</VoiceProvider> : nodo;
    }

    const { rerender } = render(<Envoltorio conProveedor={false} />);
    expect(() => rerender(<Envoltorio conProveedor />)).not.toThrow();
    expect(() => rerender(<Envoltorio conProveedor={false} />)).not.toThrow();
  });

  it('la cápsula anclada también sobrevive fuera del proveedor', () => {
    // Se monta dentro de `GameBar` y de `WaitingRoom`, que los tests de los
    // tableros renderizan SIN proveedor de voz.
    const { container } = render(<LineaCapsula variante="anclada" />);
    expect(container).not.toBeEmptyDOMElement();
  });
});

describe('LineaGlobal · un solo dueño del timbre', () => {
  beforeEach(reiniciar);

  it('el timbre se pinta UNA sola vez con tres cápsulas montadas', () => {
    pintarLinea(
      <>
        <LineaCapsula variante="anclada" />
        <LineaCapsula variante="anclada" />
        <LineaCapsula variante="anclada" />
      </>
    );

    act(() => socket.recibir('incoming_call', TIMBRE));

    expect(timbres()).toHaveLength(1);
    // Y un solo botón de «Contestar» en toda la pantalla: era exactamente el
    // síntoma de las tres tarjetas apiladas.
    expect(contestar()).toHaveLength(1);
  });

  it('es un alertdialog que NO apaga el resto de la pantalla', () => {
    pintarLinea(<button type="button">Jugar ficha</button>);
    act(() => socket.recibir('incoming_call', TIMBRE));

    const tarjeta = timbres()[0];
    expect(tarjeta.getAttribute('role')).toBe('alertdialog');
    // `aria-modal="false"` y sin `inert` alrededor: durante una partida se
    // puede tabular fuera y seguir jugando. Un diálogo que apaga el tablero te
    // quita la partida por atender el teléfono.
    expect(tarjeta.getAttribute('aria-modal')).toBe('false');
    expect(screen.getByRole('button', { name: 'Jugar ficha' }).closest('[inert]')).toBeNull();
  });

  it('Escape rechaza la llamada y devuelve el foco a quien lo tenía', async () => {
    const usuario = userEvent.setup();
    pintarLinea(<button type="button">Jugar ficha</button>);

    const abridor = screen.getByRole('button', { name: 'Jugar ficha' });
    await usuario.click(abridor);
    expect(document.activeElement).toBe(abridor);

    act(() => socket.recibir('incoming_call', TIMBRE));
    // El foco entra en el diálogo: NO en un botón, para que la tecla más
    // probable de quien acaba de oír un timbre no rechace ni conteste sola.
    expect(timbres()[0].contains(document.activeElement)).toBe(true);

    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });

    expect(socket.ultimoEmitido('decline_call')).toEqual({ callId: 'c1' });
    expect(timbres()).toHaveLength(0);
    expect(document.activeElement).toBe(abridor);
  });

  it('la cuenta atrás sale del expiraEn del servidor y no se anuncia', () => {
    vi.useFakeTimers();
    try {
      const ahora = Date.now();
      pintarLinea();
      act(() => socket.recibir('incoming_call', { ...TIMBRE, expiraEn: ahora + 22000 }));

      const reloj = document.querySelector('.linea-timbre-reloj');
      expect(reloj.textContent).toBe('22');
      // aria-hidden: un número que cambia cada segundo dentro de un diálogo que
      // acaba de tomar el foco se releería encima de los dos botones.
      expect(reloj.getAttribute('aria-hidden')).toBe('true');

      act(() => { vi.advanceTimersByTime(3000); });
      expect(document.querySelector('.linea-timbre-reloj').textContent).toBe('19');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rechazar va a la IZQUIERDA de contestar', () => {
    pintarLinea();
    act(() => socket.recibir('incoming_call', TIMBRE));
    const botones = Array.from(timbres()[0].querySelectorAll('button')).map(b => b.textContent);
    // La acción destructiva-por-accidente no puede caer bajo el pulgar en
    // reposo, y el orden del DOM tiene que coincidir con el visual.
    expect(botones).toEqual(['Rechazar', 'Contestar']);
  });
});

/**
 * LA REGLA DEL RELOJ. El rediseño de la partida gastó sus dos `role="alert"` en
 * los avisos de 10 s y 5 s, y el riel entero existe para que un turno sea una
 * decisión de diez segundos. Un movimiento de foco en el segundo 8 de una final
 * es una partida perdida.
 */
describe('LineaGlobal · el timbre no roba una final', () => {
  beforeEach(reiniciar);
  afterEach(() => { globalThis.__audio.reset(); });

  const enMiTurnoCon = (segundos) => setGameStore({
    roomId: 'ABCD',
    gameState: partidaDePrueba({ currentPlayerId: 'p_test', turnSecondsRemaining: segundos })
  });

  it('con mi turno y 8 s de reloj no toma el foco ni suena', () => {
    enMiTurnoCon(8);
    pintarLinea(<LineaCapsula variante="anclada" />);

    act(() => socket.recibir('incoming_call', TIMBRE));

    expect(timbres()).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
    // Ni un oscilador: `playGameSound('ring')` no se ha llegado a llamar.
    expect(globalThis.__audio.osciladores()).toHaveLength(0);
    // Pero la llamada NO se pierde en silencio: degrada a insignia en el chip.
    expect(document.querySelector('.linea-chip-insignia').textContent).toBe('1');
  });

  it('con 20 s de reloj el timbre aparece, suena y toma el foco', () => {
    enMiTurnoCon(20);
    pintarLinea();

    act(() => socket.recibir('incoming_call', TIMBRE));

    expect(timbres()).toHaveLength(1);
    expect(timbres()[0].contains(document.activeElement)).toBe(true);
    expect(globalThis.__audio.osciladores().length).toBeGreaterThan(0);
  });

  it('con 8 s pero NO siendo mi turno, el timbre aparece igual', () => {
    setGameStore({
      roomId: 'ABCD',
      gameState: partidaDePrueba({ currentPlayerId: 'p_rival', turnSecondsRemaining: 8 })
    });
    pintarLinea();

    act(() => socket.recibir('incoming_call', TIMBRE));
    expect(timbres()).toHaveLength(1);
  });
});

describe('LineaCapsula · la voz dentro de la partida', () => {
  beforeEach(reiniciar);

  it('en reposo dentro de una sala es un botón REAL que entra a la voz', async () => {
    globalThis.__mediaDevices.darStream();
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    pintarLinea(<LineaCapsula variante="anclada" />);

    const boton = screen.getByRole('button', { name: 'Entrar a la voz' });
    await act(async () => { boton.click(); });

    // El ciclo completo: pide micro y, con él, emite. Antes este nodo existía y
    // `display:none` lo escondía: la voz en la partida no tenía superficie.
    expect(socket.emitidos('join_table_voice')).toHaveLength(1);
  });

  it('con gente ya en la voz de la mesa, lo dice en su nombre accesible', () => {
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    pintarLinea(<LineaCapsula variante="anclada" />);

    act(() => socket.recibir('table_voice', { roomId: 'ABCD', alias: ['s_uno', 's_dos'], n: 2 }));

    expect(screen.getByRole('button', { name: 'Entrar a la voz · 2' })).toBeInTheDocument();
  });

  it('fuera de la partida NO existe en reposo, y aparece con la línea viva', async () => {
    globalThis.__mediaDevices.darStream();
    pintarLinea();
    expect(document.querySelector('.linea-capsula')).toBeNull();

    await act(async () => {
      socket.recibir('voice_pool_updated', {
        poolId: 'pool1',
        contexto: { tipo: 'privado', roomId: null },
        miembros: [
          { playerId: 'p_cuenta', name: 'Yo', estado: 'presente' },
          { playerId: 'p_amiga', name: 'Marta', estado: 'presente' }
        ]
      });
    });

    const capsula = document.querySelector('.linea-capsula');
    expect(capsula).not.toBeNull();
    // Fuera de la partida la cápsula sí lleva su propia región viva: ahí no
    // compite con las tres de la mesa.
    expect(capsula.getAttribute('role')).toBe('status');
  });
});

describe('HojaDeLinea · una sola hoja, se abra desde donde se abra', () => {
  beforeEach(reiniciar);

  it('tres cápsulas abren LA MISMA hoja, no tres', async () => {
    globalThis.__mediaDevices.darStream();
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    pintarLinea(
      <>
        <LineaCapsula variante="anclada" />
        <LineaCapsula variante="anclada" />
      </>
    );

    await act(async () => {
      socket.recibir('voice_pool_updated', {
        poolId: 'tvoice_ABCD',
        contexto: { tipo: 'mesa', roomId: 'ABCD' },
        miembros: [{ playerId: 'p_cuenta', name: 'Yo', estado: 'presente' }]
      });
    });

    const chips = screen.getAllByRole('button', { name: /Abrir la línea/ });
    expect(chips.length).toBeGreaterThanOrEqual(2);

    await act(async () => { chips[0].click(); });
    expect(document.querySelectorAll('.linea-hoja')).toHaveLength(1);

    await act(async () => { chips[1].click(); });
    // Alternar desde OTRA cápsula cierra la misma hoja: el estado es uno.
    expect(document.querySelectorAll('.linea-hoja')).toHaveLength(0);
  });

  it('los tres bloques salen SIEMPRE y en el mismo orden', async () => {
    globalThis.__mediaDevices.darStream();
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    pintarLinea();
    act(() => { useHoja.getState().abrir(); });

    const titulos = Array.from(document.querySelectorAll('.linea-bloque-titulo'))
      .map(n => n.textContent);
    // Esa constancia es la mitad del diseño: se aprende dónde mirar UNA vez.
    expect(titulos).toEqual(['Tú', 'Llamada de voz', 'Gente']);
  });

  it('el pie dice la verdad de la retransmisión, y ramifica por turnMode', async () => {
    pintarLinea();
    act(() => { useHoja.getState().abrir(); });
    // El motor arranca con 'free-fallback', que es lo que anuncia /ice-config.
    expect(document.querySelector('.linea-verdad').textContent)
      .toBe('Retransmisión de cortesía: un servidor público gratuito que puede no estar disponible.');

    act(() => { useLineaStore.setState({ relevo: 'cloudflare' }); });
    expect(document.querySelector('.linea-verdad').textContent).toBe('Con retransmisión propia');
  });

  it('el medidor de entrada tiene siete segmentos y su equivalente hablado', () => {
    pintarLinea();
    act(() => { useHoja.getState().abrir(); });

    expect(document.querySelectorAll('.linea-nivel i')).toHaveLength(7);
    const micro = document.querySelector('.linea-btn-micro');
    // Tres valores estables, no un número continuo: un medidor que se anuncie
    // sesenta veces por segundo es peor que ninguno.
    expect(micro.getAttribute('aria-description')).toBe('sin señal');

    act(() => { useLineaStore.setState({ nivel: 5, nivelPalabra: 'linea.nivelCorrecta' }); });
    expect(document.querySelectorAll('.linea-nivel i.viva')).toHaveLength(5);
    expect(document.querySelector('.linea-btn-micro').getAttribute('aria-description'))
      .toBe('señal correcta');
  });

  it('la calidad de cada par se dice con BARRAS y con PALABRA', async () => {
    globalThis.__mediaDevices.darStream();
    pintarLinea();
    await act(async () => {
      socket.recibir('voice_pool_updated', {
        poolId: 'pool1',
        contexto: { tipo: 'privado', roomId: null },
        miembros: [
          { playerId: 'p_cuenta', name: 'Yo', estado: 'presente' },
          { playerId: 'p_amiga', name: 'Marta', estado: 'presente' }
        ]
      });
    });
    act(() => {
      useLineaStore.setState({ pares: { p_amiga: 'inestable' } });
      useHoja.getState().abrir();
    });

    const fila = document.querySelector('.linea-bloque-llamada .linea-fila');
    expect(fila.textContent).toContain('Marta');
    // Un daltónico lee el estado en la palabra; la captura en blanco y negro,
    // en el número de barras encendidas.
    expect(fila.querySelector('.linea-barras-palabra').textContent).toBe('Inestable');
    expect(fila.querySelectorAll('.linea-barras-grafico i.viva')).toHaveLength(1);
  });

  it('la peor de las DOS mitades es la que se pinta', async () => {
    globalThis.__mediaDevices.darStream();
    pintarLinea();
    await act(async () => {
      socket.recibir('voice_pool_updated', {
        poolId: 'pool1',
        contexto: { tipo: 'privado', roomId: null },
        miembros: [
          { playerId: 'p_cuenta', name: 'Yo', estado: 'presente' },
          { playerId: 'p_amiga', name: 'Marta', estado: 'presente' }
        ]
      });
    });
    act(() => { useLineaStore.setState({ pares: { p_amiga: 'enlazado_bien' } }); });
    // Ella dice que NO tiene ruta hacia mí. Cada extremo sólo ve su mitad: decir
    // «bien» cuando el otro no oye nada es la misma mentira en la otra dirección.
    act(() => socket.recibir('voice_peer_state', {
      playerId: 'p_amiga', peerPlayerId: 'p_cuenta', estado: 'sin_ruta'
    }));
    act(() => { useHoja.getState().abrir(); });

    const fila = document.querySelector('.linea-bloque-llamada .linea-fila');
    expect(fila.querySelector('.linea-barras-palabra').textContent).toBe('Sin ruta');
  });
});
