import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { render, resetStores, setGameStore, setHubStore, partidaDePrueba } from './test/utils';
import { useGameStore } from './store/useGameStore';

const socket = globalThis.__socket;

/**
 * `ESTADO_LIMPIO` de test/utils.jsx todavía no declara `salaFantasma` ni
 * `sesionNoVerificada`, y `setState` de zustand MEZCLA: una bandera encendida
 * por un caso sobreviviría a `resetStores()` y contaminaría el siguiente en
 * verde y en silencio. Hasta que el arnés las declare, se apagan aquí.
 */
function reiniciar() {
  resetStores();
  setGameStore({ salaFantasma: '', sesionNoVerificada: false });
}

/**
 * Cobertura del router de vistas de App.
 *
 * Existe por A-7: App pasó de 977 líneas a 281 repartiendo el trabajo en
 * `useGameSocket`, `useGameActions` y `GameView`. Ese refactor se verificó
 * comparando el tráfico de socket antes/después, pero nada comprobaba que cada
 * rama del router siguiera pintando lo que debía. Esto lo comprueba.
 */
describe('App · router de vistas', () => {
  beforeEach(reiniciar);

  it('sin juego seleccionado muestra el hub', () => {
    render(<App />);
    expect(document.querySelector('.app-container.spectator')).toBeNull();
    // El hub lista los juegos disponibles.
    expect(screen.getByText('Dominó Online')).toBeInTheDocument();
    expect(screen.getByText('Tres en Raya')).toBeInTheDocument();
  });

  it('con juego seleccionado y sin sala muestra el lobby', () => {
    setHubStore({ selectedGameId: 'domino' });
    render(<App />);
    // El lobby pide nombre y código de sala.
    expect(screen.getByPlaceholderText(/Ej\. Alejandro/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ABCD/i)).toBeInTheDocument();
  });

  it('en una sala en espera muestra la sala de espera, no el tablero', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({
      roomId: 'ABCD',
      gameState: partidaDePrueba({ status: 'waiting' })
    });
    render(<App />);
    // Código de sala visible para invitar; sin tablero todavía.
    expect(screen.getByText('ABCD')).toBeInTheDocument();
    expect(document.querySelector('.game-area')).toBeNull();
  });

  it('en partida muestra el tablero y la mano', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    render(<App />);
    expect(document.querySelector('.game-area')).toBeInTheDocument();
    expect(document.querySelector('.board-region')).toBeInTheDocument();
  });

  /**
   * REESCRITO A PROPÓSITO. Antes afirmaba que espectar «sustituye TODO», que es
   * lo que hacía el `return` anticipado por encima del proveedor de voz: entrar
   * a ver una partida desmontaba el motor entero y cortaba la llamada.
   *
   * Lo que sustituye el espectador es la VISTA. El marco —la línea, los avisos
   * y los modales— sigue montado, que es el requisito. Lo que se comprueba aquí
   * es que ninguna OTRA vista queda debajo.
   */
  it('espectando sustituye la vista, no el marco', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) });
    render(<App />);

    expect(document.querySelector('.app-container.spectator')).toBeInTheDocument();
    // Ni el hub ni el lobby quedan debajo: `vista` es un solo valor.
    expect(screen.queryByText('Tres en Raya')).toBeNull();
    expect(screen.queryByPlaceholderText(/ABCD/i)).toBeNull();
    // Y el marco sigue ahí: el aviso de red es global, también espectando.
    expect(document.querySelector('.network-alert')).toBeInTheDocument();
  });

  it('entrar y salir de espectador no rompe el orden de hooks (regresión C-4)', () => {
    setHubStore({ selectedGameId: 'domino' });
    const { rerender } = render(<App />);

    // Entrar a espectador: cambia la rama de return de App.
    act(() => setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) }));
    rerender(<App />);
    expect(document.querySelector('.app-container.spectator')).toBeInTheDocument();

    // Y salir. Si algún hook se llamara después del return condicional, React
    // reventaría aquí con "Rendered fewer hooks than expected".
    act(() => setGameStore({ spectating: null, gameState: null }));
    rerender(<App />);
    expect(document.querySelector('.app-container.spectator')).toBeNull();
  });

  it('con torneo activo el cuadro manda sobre el hub y el lobby', () => {
    setHubStore({ selectedGameId: 'domino' });
    render(<App />);
    act(() => socket.recibir('tournament_state', {
      id: 't1', code: 'TRN1', status: 'lobby',
      players: [{ id: 'p_test', name: 'Yo' }],
      matches: []
    }));
    expect(screen.queryByText('Tres en Raya')).toBeNull();
    expect(screen.getByText('TRN1')).toBeInTheDocument();
  });
});

describe('App · avisos globales', () => {
  beforeEach(reiniciar);

  it('el aviso de conexión perdida se ve en el hub, no sólo en partida (regresión M6)', () => {
    render(<App />);
    expect(document.querySelector('.network-alert')).toBeInTheDocument();

    act(() => socket.recibir('connect'));
    expect(document.querySelector('.network-alert')).toBeNull();
  });

  it('un error del servidor se ve en el hub y se traduce', () => {
    render(<App />);
    act(() => socket.recibir('error_msg', { key: 'srv.err.roomNotFound' }));

    const toast = document.querySelector('.error-toast');
    expect(toast).toBeInTheDocument();
    // Traducido, no la clave cruda.
    expect(toast.textContent).not.toContain('srv.err.');
  });
});

/**
 * EL MARCO.
 *
 * Todo lo que tiene que sobrevivir a cambiar de pantalla —la voz, los avisos, la
 * capa social y los modales— vive por encima del router; las seis vistas sólo se
 * turnan debajo.
 *
 * Existe por el requisito literal del encargo: la llamada no se puede cortar al
 * navegar. Y había una pantalla que la cortaba POR CONSTRUCCIÓN: el espectador
 * retornaba ANTES del <VoiceProvider>, así que ir a ver una partida desmontaba
 * el motor de voz entero —y con él los RTCPeerConnection, los <audio> del body y
 * la pista del micrófono—. Salir de espectador lo volvía a montar desde cero.
 */

// Las seis vistas del router, cada una con lo mínimo que hace falta para que
// mande. `tras` es para el torneo, que se activa por un evento del servidor.
const VISTAS = [
  { nombre: 'hub', montar: () => {} },
  {
    nombre: 'lobby',
    montar: () => setHubStore({ selectedGameId: 'domino' })
  },
  {
    nombre: 'sala de espera',
    montar: () => {
      setHubStore({ selectedGameId: 'domino' });
      setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba({ status: 'waiting' }) });
    }
  },
  {
    nombre: 'partida',
    montar: () => {
      setHubStore({ selectedGameId: 'domino' });
      setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    }
  },
  {
    nombre: 'espectador',
    montar: () => setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) })
  },
  {
    nombre: 'torneo',
    montar: () => {},
    tras: () => socket.recibir('tournament_state', {
      id: 't1', code: 'TRN1', status: 'lobby',
      players: [{ id: 'p_test', name: 'Yo' }],
      matches: []
    })
  }
];

function montarVista({ montar, tras }) {
  montar();
  const utilidades = render(<App />);
  if (tras) act(tras);
  return utilidades;
}

describe('Marco global · la voz no se corta al navegar', () => {
  beforeEach(reiniciar);

  // `useVoiceChat` registra sus listeners al montar y los retira al desmontar:
  // que sigan puestos es la prueba de que el proveedor —y con él los pares y el
  // micrófono— no se ha ido. Es la comprobación que el `return` anticipado del
  // espectador ponía en rojo.
  const motorDeVozMontado = () => socket.listeners('incoming_call');

  VISTAS.forEach((vista) => {
    it(`el motor de voz está montado en: ${vista.nombre}`, () => {
      montarVista(vista);
      expect(motorDeVozMontado()).toBe(1);
    });
  });

  it('entrar y salir de espectador no desmonta el motor de voz', () => {
    setHubStore({ selectedGameId: 'domino' });
    const { rerender } = render(<App />);
    expect(motorDeVozMontado()).toBe(1);

    act(() => setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) }));
    rerender(<App />);
    expect(document.querySelector('.app-container.spectator')).toBeInTheDocument();
    expect(motorDeVozMontado()).toBe(1);

    act(() => setGameStore({ spectating: null, gameState: null }));
    rerender(<App />);
    expect(motorDeVozMontado()).toBe(1);
  });

  it('espectando se ven el aviso de red y el error del servidor', () => {
    setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) });
    render(<App />);

    expect(document.querySelector('.network-alert')).toBeInTheDocument();
    act(() => socket.recibir('error_msg', { key: 'srv.err.roomFull' }));
    expect(document.querySelector('.error-toast')).toBeInTheDocument();
  });

  /**
   * La identidad que se le entrega a la voz.
   *
   * El servidor indexa las llamadas por id de CUENTA (`p_...`), pero dentro de
   * una sala `playerId` vale el ALIAS DE ASIENTO (`s_...`) y fuera vale ''. Con
   * el alias, el filtro «este miembro del pool no soy yo» daba cierto también
   * para la entrada de uno mismo y se abría una RTCPeerConnection CONTRA UNO
   * MISMO. Aquí `cuentaId` es 'p_cuenta' y el asiento 'p_test', a propósito.
   *
   * La cifra que importa es que NO haya un par de más: cuántos abre exactamente
   * el motor es asunto suyo, no del marco.
   */
  it('el proveedor recibe la CUENTA, no el alias de asiento', async () => {
    globalThis.__mediaDevices.darStream();
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    render(<App />);

    // Un pool de dos: yo (por mi id de cuenta, como lo publica el servidor) y
    // otra persona. Se mandan los dos nombres del campo durante la ventana de
    // tolerancia, igual que hace el servidor nuevo.
    const miembros = [
      { playerId: 'p_cuenta', name: 'Yo', estado: 'presente' },
      { playerId: 'p_amiga', name: 'Marta', estado: 'presente' }
    ];
    await act(async () => {
      socket.recibir('voice_pool_updated', { poolId: 'pool1', miembros, members: miembros });
    });

    await waitFor(() => expect(RTCPeerConnection.__todas().length).toBeGreaterThanOrEqual(1));
    // Y que se asiente: con el alias, el segundo par —el que se abría contra uno
    // mismo— llega un instante después que el primero.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(RTCPeerConnection.__todas()).toHaveLength(1);
  });
});

describe('Marco global · la capa social ya no vive en la rama del lobby', () => {
  beforeEach(reiniciar);

  const meRetan = () => act(() => socket.recibir('friend_invited', { fromName: 'Marta', roomId: 'WXYZ' }));

  it('una invitación de un amigo se ve desde el hub', () => {
    render(<App />);
    meRetan();
    expect(screen.getByText('Marta te invita a jugar')).toBeInTheDocument();
  });

  it('y también dentro de la partida, que es donde se perdía entera', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    render(<App />);
    meRetan();

    const aviso = screen.getByText('Marta te invita a jugar');
    expect(aviso).toBeInTheDocument();
    // Entra como region de estado, nunca como alerta: las dos interrupciones
    // están gastadas y siguen siendo las de red y error de servidor.
    expect(aviso.closest('[role="status"]')).toBeInTheDocument();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('el aviso de una solicitud de amistad llega también espectando', () => {
    setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) });
    render(<App />);
    act(() => socket.recibir('friend_incoming', {}));
    expect(screen.getByText('Tienes una nueva solicitud de amistad')).toBeInTheDocument();
  });

  VISTAS.forEach((vista) => {
    it(`el bloque de modales se monta en: ${vista.nombre}`, () => {
      setGameStore({ showProfile: true });
      montarVista(vista);
      expect(document.querySelector('.profile-card')).toBeInTheDocument();
    });
  });

  it('el modal de amigos es el que va en ese bloque, y es la única puerta a llamar', async () => {
    const usuario = userEvent.setup();
    render(<App />);

    await usuario.click(screen.getByRole('button', { name: /Amigos/i }));
    expect(document.querySelector('.friends-modal-card')).toBeInTheDocument();
  });

  it('en la partida no se apilan dos tiendas: la de GameView es la única', async () => {
    const usuario = userEvent.setup();
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    render(<App />);

    await usuario.click(screen.getByRole('button', { name: 'Tienda de skins' }));
    // `showStore` es el MISMO estado en las dos copias: si el marco pintara
    // también la suya, saldrían dos sobrecapas idénticas y cerrar una dejaría
    // la otra encima del tablero.
    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(1);
  });

  /**
   * La partida y la sala de espera montan ya su propia superficie de voz dentro
   * de su barra. Hasta ahora al flotante lo apagaba el `roomId` que recibía el
   * proveedor; ese `roomId` se ha retirado —la voz no deduce su contexto de en
   * qué pantalla estás— y quien sabe qué pantalla hay delante es el marco.
   *
   * Se afirma «ni una de más», no un número exacto: cuántas superficies pinta la
   * línea es asunto de la línea, y esta cuenta no puede quedarse fijando la
   * forma del widget actual.
   */
  it('en la partida no se apilan dos barras de voz', async () => {
    globalThis.__mediaDevices.darStream();
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({ roomId: 'ABCD', gameState: partidaDePrueba() });
    render(<App />);

    const miembros = [
      { playerId: 'p_cuenta', name: 'Yo', estado: 'presente' },
      { playerId: 'p_amiga', name: 'Marta', estado: 'presente' }
    ];
    await act(async () => {
      socket.recibir('voice_pool_updated', { poolId: 'pool1', miembros, members: miembros });
    });

    expect(document.querySelectorAll('.unified-voice-wrapper').length).toBeLessThanOrEqual(1);
  });
});

/**
 * Las dos bandas del vestíbulo, que pintan banderas del store.
 *
 * La de la sala fantasma sustituye a un `role="alert"` rojo que volvía en CADA
 * recarga porque nadie borraba `domino_room_id` de sessionStorage. La de sesión
 * sin verificar es el modo degradado que hasta ahora no tenía ni un síntoma en
 * pantalla: se juega y se habla, pero nadie te ve ni te puede llamar.
 */
describe('Vestíbulo · bandas de sala fantasma y de sesión', () => {
  beforeEach(reiniciar);

  it('la sala guardada que ya no existe se puede olvidar', async () => {
    const usuario = userEvent.setup();
    setGameStore({ salaFantasma: 'ABCD' });
    render(<App />);

    const banda = document.querySelector('.vest-reanudar');
    expect(banda).toBeInTheDocument();
    // Aviso descartable, no interrupción.
    expect(banda.getAttribute('role')).toBe('status');
    expect(document.querySelector('.error-toast')).toBeNull();

    await usuario.click(screen.getByRole('button', { name: 'Olvidarla' }));
    expect(document.querySelector('.vest-reanudar')).toBeNull();
    expect(useGameStore.getState().salaFantasma).toBe('');
  });

  it('[Reintentar] vuelve a pedir la sala por su código y retira la banda', async () => {
    const usuario = userEvent.setup();
    setGameStore({ salaFantasma: 'ABCD', name: 'Yo' });
    render(<App />);

    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));

    // El código es el único rastro que queda: `onErrorMsg` ya vació sessionStorage.
    expect(socket.ultimoEmitido('join_room')).toMatchObject({ roomId: 'ABCD' });
    expect(document.querySelector('.vest-reanudar')).toBeNull();
  });

  it('la sesión sin verificar se anuncia y se puede reintentar sin reconectar', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    act(() => socket.recibir('session', { authed: false, reason: 'no_disponible' }));

    const banda = document.querySelector('.ov-degradado');
    expect(banda).toBeInTheDocument();
    expect(banda.getAttribute('role')).toBe('status');
    expect(banda.textContent).toMatch(/Modo invitado/);

    socket.limpiarEmitidos();
    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));
    // El re-handshake completo: identidad y, pegado a él, el saludo a la voz.
    expect(socket.emitidos('hello')).toHaveLength(1);
    expect(socket.emitidos('voice_hello')).toHaveLength(1);
  });

  it('ninguna de las dos bandas entra en la partida', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({
      roomId: 'ABCD', gameState: partidaDePrueba(),
      salaFantasma: 'WXYZ', sesionNoVerificada: true
    });
    render(<App />);

    expect(document.querySelector('.vest-reanudar')).toBeNull();
    expect(document.querySelector('.ov-degradado')).toBeNull();
    // Y por tanto la partida sigue con sus tres regiones vivas y ni una cuarta.
    act(() => socket.recibir('connect'));
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});

/**
 * Composición de la mesa (rediseño): la partida montada de verdad, con la cinta
 * en lugar de los asientos flotantes y el DOM en el orden en el que se juega.
 *
 * Estas comprobaciones son de integración a propósito. Cada pieza (cinta, riel,
 * mano, motor de mesa) tiene su propia suite, pero nada comprobaba que la vista
 * real las montara todas, en el orden acordado y con las props que esperan; y
 * es justo ahí donde se pierden las cosas al retirar un componente.
 */

// La partida de prueba viene sin poderes: aquí hacen falta para que la fila de
// cartas exista y para poder recorrer las cinco rutas de selección.
function partidaConPoderes(extra = {}) {
  const base = partidaDePrueba({ powersEnabled: true, ...extra });
  base.players = base.players.map(p => (
    p.id === 'p_test'
      ? { ...p, powers: [{ id: 'freeze', type: 'attack', rarity: 'common' }] }
      : p
  ));
  return base;
}

function montarPartida(gameState = partidaConPoderes()) {
  setHubStore({ selectedGameId: 'domino' });
  setGameStore({ roomId: 'ABCD', gameState });
  return render(<App />);
}

describe('Partida · composición de la mesa', () => {
  beforeEach(reiniciar);

  it('monta las bandas de la partida y ninguna sobra', () => {
    montarPartida();
    const area = document.querySelector('.game-area');

    expect(area.querySelector('.cinta')).toBeInTheDocument();
    expect(area.querySelector('.player-hand-container')).toBeInTheDocument();
    expect(area.querySelector('.power-cards-wrap')).toBeInTheDocument();
    expect(area.querySelector('.board-region')).toBeInTheDocument();
    // Los nombres que fijan otros tests y toda la cascada no se renombran.
    expect(document.querySelector('.game-area')).toBeInTheDocument();
  });

  it('los asientos flotantes ya no existen', () => {
    montarPartida();
    expect(document.querySelector('.seat')).toBeNull();
    expect(document.querySelector('.seat-taunt-bubble')).toBeNull();
    expect(document.querySelector('.voice-spectrum-ring')).toBeNull();
  });

  it('el DOM va en el orden en el que se juega, no en el orden visual', () => {
    montarPartida();
    const area = document.querySelector('.game-area');
    const marcas = [
      '.salto-a-mano', '.player-hand-container', '.power-cards-wrap',
      '.cinta', '.board-region'
    ];
    const nodos = [...area.querySelectorAll(marcas.join(', '))];
    const orden = nodos.map(nodo => marcas.find(m => nodo.matches(m)));
    expect(orden).toEqual(marcas);
  });

  it('cada banda declara el `order` que le toca', () => {
    montarPartida();
    const area = document.querySelector('.game-area');
    // El que declara su hoja propia (cinta.css) no se
    // comprueba aquí: en jsdom no hay CSS cargado y saldría vacío. Sí los
    // tres que este paquete escribe en línea, que son los que se perderían sin
    // que nadie se enterara.
    expect(area.querySelector('#mano-jugador').style.order).toBe('5');
    expect(area.querySelector('.power-cards-wrap').parentElement.style.order).toBe('3');
    expect(area.querySelector('.board-region').style.order).toBe('2');
  });

  it('la barra va detrás del tablero en el DOM y vuelve arriba con order -1', () => {
    montarPartida();
    const barra = document.querySelector('.game-bar');
    const area = document.querySelector('.game-area');

    const barraDespues = area.compareDocumentPosition(barra) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(barraDespues).toBeTruthy();
    expect(barra.style.order).toBe('-1');
  });

  it('la barra ya no lleva ni la píldora de turno ni el reloj', () => {
    montarPartida();
    expect(document.querySelector('.game-bar-turn')).toBeNull();
    expect(document.querySelector('.game-bar-timer')).toBeNull();
    // Lo que sí se queda.
    expect(document.querySelector('.game-bar-round')).toBeInTheDocument();
    expect(document.querySelector('.game-bar-score')).toBeInTheDocument();
  });

  it('los botones de tienda y ranking tienen nombre traducido y sin proveedor', () => {
    montarPartida();
    const tienda = screen.getByRole('button', { name: 'Tienda de skins' });
    const ranking = screen.getByRole('button', { name: 'Ver el ranking' });
    // Los dos atributos por separado: `title` solo no da nombre accesible
    // fiable, y `aria-label` solo deja el globo del ratón sin traducir. Se
    // comprueban a mano porque getByRole se conforma con cualquiera de los dos.
    expect(tienda).toHaveAttribute('aria-label', 'Tienda de skins');
    expect(tienda).toHaveAttribute('title', 'Tienda de skins');
    expect(ranking).toHaveAttribute('aria-label', 'Ver el ranking');
    expect(ranking).toHaveAttribute('title', 'Ver el ranking');
    // Y el nombre del proveedor no se cuela por ningún atributo.
    expect(document.querySelector('[title*="Supabase"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Supabase/i);
  });

  it('el cartel de turno a pantalla completa y el pulso del borde han desaparecido', () => {
    montarPartida();
    expect(document.querySelector('.turn-splash-overlay')).toBeNull();
    expect(document.querySelector('.app-container.my-turn-active')).toBeNull();
  });

  it('el enlace de salto es la primera parada de tabulación y apunta a la mano', async () => {
    const usuario = userEvent.setup();
    montarPartida();

    const salto = document.querySelector('.salto-a-mano');
    expect(salto.getAttribute('href')).toBe('#mano-jugador');
    // El destino tiene que poder recibir el foco, o el enlace no lleva a nada.
    const destino = document.getElementById('mano-jugador');
    expect(destino.getAttribute('tabindex')).toBe('-1');
    expect(destino.querySelector('.player-hand-container')).toBeInTheDocument();

    await usuario.tab();
    expect(document.activeElement).toBe(salto);
  });

  it('tabular desde el enlace de salto llega a la mano antes que a la barra', async () => {
    const usuario = userEvent.setup();
    montarPartida();

    await usuario.tab(); // enlace de salto
    await usuario.tab(); // primera ficha de la mano (roving tabindex: una sola)
    expect(document.activeElement.className).toMatch(/mano-ficha/);
  });

  it('hay exactamente tres tipos de región viva y ni una cuarta', () => {
    montarPartida();
    // El turno (cinta) y la crónica (GameView). Las de role="alert" son las de
    // App y sólo existen mientras hay aviso: aquí ya hay conexión.
    act(() => socket.recibir('connect'));
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="log"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('la crónica existe vacía, antes de que llegue el primer aviso', () => {
    montarPartida();
    const cronica = document.querySelector('[role="log"]');
    expect(cronica).toBeInTheDocument();
    expect(cronica.children).toHaveLength(0);

    act(() => socket.recibir('receive_quick_message', {
      playerId: 'p_rival', playerName: 'Rival', text: '¡Capicúa!', type: 'phrase', key: 'chat.p0'
    }));
    expect(document.querySelector('[role="log"] .floating-toast')).toBeInTheDocument();
  });

  it('la mano refleja el estado del turno', () => {
    montarPartida();
    expect(document.querySelector('.hand-status-row')).toBeInTheDocument();
  });

  it('la cinta recibe los pases del servidor y los pinta en el chip', () => {
    // playerPassedOn llega indexado por jugador y con repetidos: el servidor
    // apunta un pase por cada extremo abierto. La cinta ordena y deduplica.
    montarPartida(partidaConPoderes({ playerPassedOn: { p_rival: [5, 3, 3] } }));

    const fallos = document.querySelector('.cinta-fallos');
    expect(fallos).toBeInTheDocument();
    expect([...fallos.querySelectorAll('.cinta-fallo')].map(n => n.textContent)).toEqual(['3', '5']);
    // Y en el chip de quien no ha pasado no se pinta nada.
    expect(document.querySelectorAll('.cinta-fallos')).toHaveLength(1);
  });

  it('el reloj vive en el chip activo y no en la barra', () => {
    montarPartida(partidaConPoderes({
      turnEndsAt: Date.now() + 20000,
      turnSecondsRemaining: 20,
      turnDurationSeconds: 30
    }));

    const activo = document.querySelector('.cinta-chip-activo');
    expect(activo.querySelector('.cinta-reloj-drenaje')).toBeInTheDocument();
    expect(activo.querySelector('.cinta-reloj-numeral').textContent).toBe('20');
    // El numeral no se locuta: el reloj se anuncia dos veces por turno, no
    // segundo a segundo.
    expect(activo.querySelector('.cinta-reloj-numeral')).toHaveAttribute('aria-hidden', 'true');
    // `turnDurationSeconds` NO se puede comprobar aquí: sólo decide la fracción
    // de arranque del drenaje, y el efecto escribe scaleY(0) en la misma pasada,
    // así que el DOM final es idéntico con y sin ella.
  });

  it('elegir ficha y pulsar un extremo del tablero juega ESA ficha por ESE lado', async () => {
    const usuario = userEvent.setup();
    montarPartida();

    act(() => useGameStore.getState().setSelectedTileIndex(0));
    const btnIzq = document.querySelector('.board-placeholder-circle');
    expect(btnIzq).toBeInTheDocument();
    await usuario.click(btnIzq);

    expect(socket.ultimoEmitido('play_tile')).toMatchObject({ tileIndex: 0, side: 'left' });
  });

  it('sin jugadas posibles el botón de robar sale en la mano', () => {
    // Mano que no encaja por ningún extremo (6 y 5): hay que robar.
    montarPartida(partidaConPoderes({
      players: [
        { id: 'p_test', name: 'Yo', hand: [[1, 2]], handCount: 1, score: 0, powers: [], ready: true, isBot: false },
        { id: 'p_rival', name: 'Rival', hand: [], handCount: 5, score: 0, powers: [], ready: true, isBot: true }
      ]
    }));

    expect(document.querySelector('.hand-status-row')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /robar/i })).toBeInTheDocument();
  });
});

/**
 * Las cinco rutas de selección de un poder.
 *
 * Son el punto más frágil de retirar `PlayerSeats`: hasta ahora el único camino
 * de `player_target` y `smuggle_select_player` era el par `pointer-events:none`
 * / `.targetable` de los asientos, y ninguna de las cinco tenía cobertura. Aquí
 * se recorren de punta a punta, desde el nodo que se toca hasta el `emit`.
 */
describe('Partida · las cinco rutas de poderes', () => {
  beforeEach(reiniciar);

  const apuntar = (id, tipo) => act(() => {
    useGameStore.getState().setSelectedPower({ id });
    useGameStore.getState().setPendingTargetType(tipo);
  });

  it('end_target: los extremos del tablero apuntan el poder en vez de jugar', async () => {
    const usuario = userEvent.setup();
    montarPartida();
    apuntar('freeze', 'end_target');

    const botones = document.querySelectorAll('.board-placeholder-circle');
    expect(botones.length).toBeGreaterThanOrEqual(2);
    await usuario.click(botones[1]);

    expect(socket.ultimoEmitido('use_power_card'))
      .toMatchObject({ cardId: 'freeze', targetId: 'right', tileIndex: null });
    // Y no se ha jugado ninguna ficha por el camino.
    expect(socket.emitidos('play_tile')).toHaveLength(0);
  });

  it('player_target: el chip del rival es pulsable y manda su id', async () => {
    const usuario = userEvent.setup();
    montarPartida();
    apuntar('spy_eye', 'player_target');

    const objetivos = document.querySelectorAll('.cinta-chip-objetivo');
    // Nadie se apunta a sí mismo: de dos chips, sólo el del rival.
    expect(objetivos).toHaveLength(1);
    await usuario.click(objetivos[0]);

    expect(socket.ultimoEmitido('use_power_card'))
      .toMatchObject({ cardId: 'spy_eye', targetId: 'p_rival' });
  });

  it('player_target: el chip también responde al teclado', async () => {
    const usuario = userEvent.setup();
    montarPartida();
    apuntar('curse', 'player_target');

    const chip = document.querySelector('.cinta-chip-objetivo');
    chip.focus();
    await usuario.keyboard('{Enter}');

    expect(socket.ultimoEmitido('use_power_card'))
      .toMatchObject({ cardId: 'curse', targetId: 'p_rival' });
  });

  it('hand_tile_target: tocar una ficha de la mano la manda como objetivo', async () => {
    const usuario = userEvent.setup();
    montarPartida();
    apuntar('trade', 'hand_tile_target');

    // La segunda ficha de la mano en el orden del servidor es [3,4].
    await usuario.click(screen.getByRole('button', { name: /ficha 3 y 4/i }));

    expect(socket.ultimoEmitido('use_power_card'))
      .toMatchObject({ cardId: 'trade', targetId: null, tileIndex: 1 });
    expect(socket.emitidos('play_tile')).toHaveLength(0);
  });

  it('smuggle: primero la ficha, después el jugador, y viajan las dos cosas', async () => {
    const usuario = userEvent.setup();
    montarPartida();
    apuntar('smuggle', 'smuggle_select_tile');

    await usuario.click(screen.getByRole('button', { name: /doble 6/i }));
    // El primer paso no emite nada todavía: sólo cambia de fase.
    expect(socket.emitidos('use_power_card')).toHaveLength(0);
    expect(useGameStore.getState().pendingTargetType).toBe('smuggle_select_player');
    expect(useGameStore.getState().smuggleTileIdx).toBe(0);

    await usuario.click(document.querySelector('.cinta-chip-objetivo'));

    expect(socket.ultimoEmitido('use_power_card'))
      .toMatchObject({ cardId: 'smuggle', targetId: 'p_rival', tileIndex: 0 });
  });

  it('fuera de un poder, ningún chip es pulsable', () => {
    montarPartida();
    expect(document.querySelector('.cinta-chip-objetivo')).toBeNull();
    expect(document.querySelectorAll('.cinta-chip[role="button"]')).toHaveLength(0);
    document.querySelectorAll('.cinta-chip').forEach(chip => {
      expect(chip.getAttribute('tabindex')).toBeNull();
    });
  });

  it('la carta de poder sigue apuntando desde la fila montada en la mesa', async () => {
    const usuario = userEvent.setup();
    montarPartida();

    await usuario.click(screen.getByRole('button', { name: /Congelar/i }));

    expect(useGameStore.getState().pendingTargetType).toBe('end_target');
    expect(document.querySelectorAll('.board-placeholder-circle')).toHaveLength(2);
  });
});

/**
 * GameView es de los TRES juegos del hub, no sólo del dominó: el reordenado del
 * DOM y la región de la crónica viven ahí, así que un tablero que no sea el de
 * dominó tiene que seguir montándose igual y sin heredar ninguna banda ajena.
 */
describe('Otros juegos · GameView sigue siendo común', () => {
  beforeEach(reiniciar);

  it('el tres en raya se monta con la barra y sin las bandas del dominó', () => {
    setHubStore({ selectedGameId: 'tictactoe' });
    setGameStore({
      roomId: 'ABCD',
      gameState: {
        gameType: 'tictactoe', roomId: 'ABCD', status: 'playing',
        board: Array(9).fill(null), currentPlayerId: 'p_test',
        symbols: { p_test: 'X', p_bot: 'O' }, scores: { X: 0, O: 0 },
        roundNumber: 1, maxScore: 3, teamScores: [0, 0],
        players: [
          { id: 'p_test', name: 'Yo', isBot: false, score: 0 },
          { id: 'p_bot', name: 'Robotín', isBot: true, score: 0 }
        ]
      }
    });
    render(<App />);

    expect(document.querySelectorAll('.tictactoe-cell')).toHaveLength(9);
    expect(document.querySelector('.game-bar')).toBeInTheDocument();
    expect(document.querySelector('.game-bar').style.order).toBe('-1');
    expect(document.querySelector('.cinta')).toBeNull();
    expect(document.querySelector('.riel')).toBeNull();
    expect(document.querySelector('.player-hand-container')).toBeNull();
    // La crónica es del marco, no del dominó: existe también aquí.
    expect(document.querySelector('[role="log"]')).toBeInTheDocument();
  });
});

describe('Espectador · misma mesa, otro presupuesto', () => {
  beforeEach(reiniciar);

  function montarEspectador() {
    setGameStore({ spectating: 'ABCD', gameState: partidaDePrueba({ isSpectator: true }) });
    return render(<App />);
  }

  it('ve la cinta con todos los jugadores, sin riel ni mano', () => {
    montarEspectador();
    expect(document.querySelectorAll('.cinta-chip')).toHaveLength(2);
    expect(document.querySelector('.riel')).toBeNull();
    expect(document.querySelector('.player-hand-container')).toBeNull();
  });

  it('ningún chip se destaca como propio ni es pulsable', () => {
    montarEspectador();
    expect(document.querySelector('.cinta-chip-yo')).toBeNull();
    expect(document.querySelector('.cinta-chip-objetivo')).toBeNull();
  });

  it('la mesa sigue colgando de .board-region.spec-board', () => {
    montarEspectador();
    const marco = document.querySelector('.board-region.spec-board');
    expect(marco).toBeInTheDocument();
    expect(marco.querySelector('.game-board-container')).toBeInTheDocument();
    expect(marco.querySelector('.cinta')).toBeInTheDocument();
  });
});

