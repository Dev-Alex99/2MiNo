import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import useModalA11y from './useModalA11y';
import MoveLog from '../components/MoveLog';
import PowerCards from '../components/PowerCards';
import EndGameModal from '../components/EndGameModal';
import FriendsModal from '../components/FriendsModal';
import ProfileModal from '../components/ProfileModal';
import SkinStoreModal from '../components/SkinStoreModal';
import LeaderboardModal from '../components/LeaderboardModal';
import ReplayModal from '../components/ReplayModal';
import RankedSearch from '../components/RankedSearch';
import TournamentEntry from '../components/TournamentEntry';
import TournamentBracket from '../components/TournamentBracket';
import TournamentHub from '../components/TournamentHub';
import { useSocialStore, ESPERA_MAXIMA_MS } from '../social/useSocialStore';
import { render, resetStores, setGameStore, partidaDePrueba } from '../test/utils';

const socket = globalThis.__socket;

/**
 * Este archivo cubre TODO el paquete de accesibilidad transversal, no sólo el
 * hook: MoveLog y PowerCards no tienen archivo de test propio y crear uno
 * habría tocado ficheros que no son de este paquete.
 */

// Diálogo mínimo con la forma corta del hook, que es la que se documenta.
function Dialogo({ onClose, etiqueta }) {
  const { propsPanel, propsTitulo } = useModalA11y(onClose, etiqueta ? { etiqueta } : undefined);
  return (
    <div className="modal-overlay">
      <div className="modal-card modal-a11y" {...propsPanel}>
        {!etiqueta && <h2 {...propsTitulo}>Título de prueba</h2>}
        <button type="button">Uno</button>
        <button type="button">Dos</button>
      </div>
    </div>
  );
}

// El botón de apertura vive FUERA del diálogo: es el que tiene que recuperar el
// foco al cerrar y el que tiene que quedarse inerte mientras está abierto.
function Anfitrion({ onClose }) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = () => { setAbierto(false); if (onClose) onClose(); };
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}>Abrir</button>
      {abierto && <Dialogo onClose={cerrar} />}
    </>
  );
}

const paradas = () => Array.from(document.querySelectorAll('.modal-card button'));

describe('useModalA11y', () => {
  it('al abrir, el foco entra en el panel (en el título)', async () => {
    const user = userEvent.setup();
    render(<Anfitrion />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(document.activeElement).toBe(screen.getByText('Título de prueba'));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    // El título es el nombre accesible del diálogo, no un texto suelto.
    expect(screen.getByRole('dialog', { name: 'Título de prueba' })).toBeInTheDocument();
  });

  it('el título recibe el foco pero NO es una parada del ciclo de Tab', async () => {
    const user = userEvent.setup();
    render(<Anfitrion />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(screen.getByText('Título de prueba')).toHaveAttribute('tabindex', '-1');
  });

  it('Tab cicla dentro del panel y no se sale', async () => {
    const user = userEvent.setup();
    render(<Anfitrion />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await user.click(abrir);

    const [uno, dos] = paradas();

    // Desde el último, Tab vuelve al primero en vez de saltar al navegador.
    dos.focus();
    fireEvent.keyDown(dos, { key: 'Tab' });
    expect(document.activeElement).toBe(uno);

    // Desde el primero, Mayús+Tab va al último.
    fireEvent.keyDown(uno, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(dos);

    // Desde el título (tabIndex -1, no está en la lista) hacia atrás: último.
    screen.getByText('Título de prueba').focus();
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(dos);

    // Y si el foco se ha escapado fuera (clic en el fondo del overlay, un
    // navegador sin `inert`), el siguiente Tab lo devuelve al diálogo.
    abrir.focus();
    fireEvent.keyDown(abrir, { key: 'Tab' });
    expect(document.activeElement).toBe(uno);
  });

  it('Escape llama a onClose', async () => {
    const user = userEvent.setup();
    const alCerrar = vi.fn();
    render(<Anfitrion onClose={alCerrar} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it('al cerrar, el foco vuelve al botón que lo abrió', async () => {
    const user = userEvent.setup();
    render(<Anfitrion />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await user.click(abrir);
    expect(document.activeElement).not.toBe(abrir);

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(abrir);
  });

  it('el resto de la app queda inerte mientras el diálogo está abierto, y se restaura', async () => {
    const user = userEvent.setup();
    render(<Anfitrion />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await user.click(abrir);

    expect(abrir).toHaveAttribute('inert');
    expect(abrir).toHaveAttribute('aria-hidden', 'true');

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });

    expect(abrir).not.toHaveAttribute('inert');
    expect(abrir).not.toHaveAttribute('aria-hidden');
  });

  it('con dos diálogos abiertos, Escape sólo cierra el de arriba', () => {
    const deAbajo = vi.fn();
    const deArriba = vi.fn();
    render(
      <>
        <Dialogo onClose={deAbajo} />
        <Dialogo onClose={deArriba} />
      </>
    );

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });

    expect(deArriba).toHaveBeenCalledTimes(1);
    expect(deAbajo).not.toHaveBeenCalled();
  });

  it('un diálogo sin título se nombra con la opción `etiqueta`', () => {
    render(<Dialogo onClose={() => {}} etiqueta="Buscando rival" />);

    const dialogo = screen.getByRole('dialog', { name: 'Buscando rival' });
    expect(dialogo).not.toHaveAttribute('aria-labelledby');
    // Sin título al que ir, el foco cae en la primera parada real.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Uno' }));
  });

  /**
   * El diálogo que NO apaga la app. Es lo que el timbre de la línea necesita:
   * una llamada entrante llega mientras juegas, y un diálogo que vuelve inerte
   * el tablero te quita la partida por atender el teléfono.
   */
  it('con { aislar: false } mueve el foco y cierra con Escape, pero NO apaga el resto', async () => {
    const user = userEvent.setup();
    const alCerrar = vi.fn();
    function Timbre({ onClose }) {
      const { propsPanel, propsTitulo } = useModalA11y(onClose, { aislar: false, rol: 'alertdialog' });
      return (
        <div className="modal-card" {...propsPanel}>
          <h2 {...propsTitulo}>Marta te llama</h2>
          <button type="button">Contestar</button>
        </div>
      );
    }
    function Anfitrion2() {
      const [abierto, setAbierto] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setAbierto(true)}>Abrir</button>
          {abierto && <Timbre onClose={() => { setAbierto(false); alCerrar(); }} />}
        </>
      );
    }
    render(<Anfitrion2 />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await user.click(abrir);

    // El foco entra igual que en un modal normal…
    expect(document.activeElement).toBe(screen.getByText('Marta te llama'));
    // …pero el resto de la pantalla sigue viva: se puede tabular fuera y seguir
    // jugando. Eso es lo único que cambia.
    expect(abrir).not.toHaveAttribute('inert');
    expect(abrir).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'false');

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(abrir);
  });

  it('la forma larga rellena la ref que le pasan', () => {
    let visto = null;
    function ConRef() {
      const refPanel = useRef(null);
      const { propsPanel, propsTitulo } = useModalA11y(refPanel, () => {});
      visto = refPanel;
      return (
        <div className="modal-card" {...propsPanel}>
          <h2 {...propsTitulo}>Con ref</h2>
        </div>
      );
    }
    render(<ConRef />);

    expect(visto.current).toBe(screen.getByRole('dialog'));
  });
});

describe('MoveLog', () => {
  const entradas = [
    { id: 'a', time: '10:00:00', player: 'Ana', action: 'play', tile: [6, 3], side: 'left' },
    { id: 'b', time: '10:00:10', player: 'Ana', action: 'pass', ends: [3, 5] },
    { id: 'c', time: '10:00:20', player: 'Bruno', action: 'pass' }
  ];

  it('sale por portal fuera del contenedor del tablero y es un role=dialog', () => {
    render(
      <div className="game-board-container">
        <MoveLog moveLog={entradas} onClose={() => {}} />
      </div>
    );

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toBeInTheDocument();
    // Es la razón de ser del portal: dentro del contenedor heredaba su
    // touch-action y la lista no se podía desplazar con el dedo.
    expect(document.querySelector('.game-board-container').contains(dialogo)).toBe(false);
    expect(dialogo.closest('.game-board-container')).toBeNull();
  });

  it('el botón de cerrar se anuncia «Cerrar», no «Cancelar»', () => {
    render(<MoveLog moveLog={entradas} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });

  it('la entrada de pase enseña los extremos sólo cuando el servidor los manda', () => {
    render(<MoveLog moveLog={entradas} onClose={() => {}} />);

    // Con extremos: el pase de Ana revela que no tenía ni 3 ni 5.
    expect(screen.getByText(/Izq 3/)).toBeInTheDocument();
    expect(screen.getByText(/Der 5/)).toBeInTheDocument();

    // Sin extremos (pase forzado por un poder, o una fila guardada antes de
    // que el servidor los enviara) no se inventa nada.
    const detalles = Array.from(document.querySelectorAll('.move-log-detail')).map((e) => e.textContent);
    expect(detalles.filter((d) => d === 'Pasó turno')).toHaveLength(1);
  });

  it('la lista con scroll es alcanzable con el teclado', () => {
    render(<MoveLog moveLog={entradas} onClose={() => {}} />);
    expect(document.querySelector('.move-log-body')).toHaveAttribute('tabindex', '0');
  });
});

describe('EndGameModal', () => {
  const finDeRonda = (extra = {}) => partidaDePrueba({
    status: 'round_ended',
    roundWinner: 'p_rival',
    ...extra
  });

  it('toma el foco cuando por fin se monta, 4,1 s tarde', () => {
    vi.useFakeTimers();
    try {
      render(<EndGameModal gameState={finDeRonda()} playerId="p_test" />);
      // Durante la espera no hay diálogo: es el caso que rompe una ref normal.
      expect(screen.queryByRole('dialog')).toBeNull();

      act(() => { vi.advanceTimersByTime(4200); });

      const dialogo = screen.getByRole('dialog');
      expect(dialogo.contains(document.activeElement)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('con movimiento reducido no se lanza el confeti', () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    });
    vi.useFakeTimers();
    try {
      // Ganando la ronda, que es cuando el confeti aparece.
      render(<EndGameModal gameState={finDeRonda({ roundWinner: 'p_test' })} playerId="p_test" />);
      act(() => { vi.advanceTimersByTime(4200); });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(document.querySelector('canvas')).toBeNull();
    } finally {
      vi.useRealTimers();
      window.matchMedia = original;
    }
  });
});

describe('PowerCards', () => {
  const carta = { id: 'freeze', type: 'attack', rarity: 'common' };

  const pintar = (props = {}) => render(
    <PowerCards
      powers={[carta]}
      isMyTurn={false}
      onUsePower={() => {}}
      selectedPower={null}
      setSelectedPower={() => {}}
      pendingTargetType={null}
      setPendingTargetType={() => {}}
      {...props}
    />
  );

  it('la carta es un botón de verdad, con estado y descripción', () => {
    pintar();

    const boton = screen.getByRole('button', { name: 'Congelar Extremo' });
    expect(boton.tagName).toBe('BUTTON');
    expect(boton).toHaveAttribute('aria-pressed', 'false');

    // La descripción es la suya, no la del panel compartido.
    const desc = document.getElementById(boton.getAttribute('aria-describedby'));
    expect(desc.textContent).toBe(boton.getAttribute('title'));
    expect(desc.textContent.length).toBeGreaterThan(0);
  });

  it('fuera de turno usa aria-disabled y NUNCA el atributo disabled', async () => {
    const user = userEvent.setup();
    const usar = vi.fn();
    const elegir = vi.fn();
    pintar({ isMyTurn: false, onUsePower: usar, setSelectedPower: elegir });

    const boton = screen.getByRole('button', { name: 'Congelar Extremo' });
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    // Con `disabled` la carta saldría del orden de tabulación y un usuario de
    // lector no podría ni leer su propia mano de poderes.
    expect(boton).not.toBeDisabled();

    await user.click(boton);
    expect(usar).not.toHaveBeenCalled();
    expect(elegir).not.toHaveBeenCalled();
  });

  it('en turno, elegir una carta de objetivo la marca como pulsada', async () => {
    const user = userEvent.setup();
    const elegir = vi.fn();
    const objetivo = vi.fn();
    pintar({ isMyTurn: true, setSelectedPower: elegir, setPendingTargetType: objetivo });

    await user.click(screen.getByRole('button', { name: 'Congelar Extremo' }));

    expect(elegir).toHaveBeenCalledWith(carta);
    expect(objetivo).toHaveBeenCalledWith('end_target');
  });

  it('la fila declara la variante compacta', () => {
    pintar();
    expect(document.querySelector('.power-cards-wrap')).toHaveClass('poderes-compacto');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   LOS DIEZ OVERLAYS SOCIALES Y DE TORNEO

   Ninguno tenía role="dialog", ninguno cerraba con Escape y ninguno devolvía el
   foco: un usuario de teclado quedaba tabulando a ciegas por detrás del
   diálogo. La tabla los recorre todos con el MISMO recorrido, que es lo que
   evita que el siguiente que se añada se olvide de la mitad.
   ═══════════════════════════════════════════════════════════════════════════ */

// El abridor vive FUERA del diálogo: es quien tiene que recuperar el foco.
function Sobrecapa({ crear }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}>Abrir</button>
      {abierto && crear(() => setAbierto(false))}
    </>
  );
}

const torneoEnCuadro = {
  status: 'active',
  reward: 100,
  youSeed: 0,
  humans: [{ name: 'Yo' }],
  seeds: [{ name: 'Yo' }, { name: 'Ana' }, { name: 'Luis' }, { name: 'Bot' }],
  bracket: { sf1: { winner: null }, sf2: { winner: null }, final: { a: null, b: null } }
};

const OVERLAYS = [
  {
    nombre: 'FriendsModal',
    cerrar: 'Cerrar',
    crear: (fin) => <FriendsModal name="Yo" onClose={fin} />
  },
  {
    nombre: 'ProfileModal',
    cerrar: 'Cerrar',
    crear: (fin) => <ProfileModal name="Yo" onClose={fin} />
  },
  {
    nombre: 'SkinStoreModal',
    cerrar: 'Cerrar',
    crear: (fin) => <SkinStoreModal playerId="p_cuenta" name="Yo" onClose={fin} />
  },
  {
    nombre: 'LeaderboardModal',
    cerrar: 'Cerrar',
    crear: (fin) => <LeaderboardModal onClose={fin} />
  },
  {
    nombre: 'ReplayModal',
    cerrar: 'Cerrar',
    crear: (fin) => <ReplayModal matchId="m1" onClose={fin} />
  },
  {
    // Su cierre es la cancelación de la cola: no tiene otra salida.
    nombre: 'RankedSearch',
    cerrar: 'Cancelar',
    crear: (fin) => <RankedSearch onCancel={fin} />
  },
  {
    nombre: 'TournamentEntry',
    cerrar: 'Cerrar',
    crear: (fin) => <TournamentEntry onCreate={() => {}} onJoin={() => {}} onClose={fin} />
  },
  {
    nombre: 'TournamentBracket',
    cerrar: 'Cerrar',
    crear: (fin) => <TournamentBracket gameState={partidaDePrueba()} onClose={fin} />
  },
  {
    nombre: 'TournamentHub vestibulo',
    cerrar: 'Salir',
    crear: (fin) => (
      <TournamentHub
        tournament={{ status: 'lobby', code: 'TABCD', reward: 100, humans: [{ name: 'Yo' }], isHost: true }}
        onStart={() => {}} onPlayMatch={() => {}} onExit={fin}
      />
    )
  },
  {
    nombre: 'TournamentHub cuadro',
    cerrar: 'Salir',
    crear: (fin) => (
      <TournamentHub tournament={torneoEnCuadro} onStart={() => {}} onPlayMatch={() => {}} onExit={fin} />
    )
  }
];

function limpiarSocial() {
  resetStores();
  useSocialStore.getState().reiniciarSocial();
}

/**
 * El reinicio del store social al TERMINAR va envuelto en `act`, y no es una
 * ceremonia: los `afterEach` de un `describe` corren ANTES del `cleanup` de
 * testing-library, así que el árbol sigue montado cuando se vacía el store.
 * Vaciarlo cambia `amigos`, `solicitudes` y `estado` a la vez, cada uno con su
 * propia suscripción, y las tres re-renderizaciones salían fuera de act
 * llenando el stderr de avisos que no correspondían a ningún fallo real.
 */
function cerrarSocial() {
  act(() => { useSocialStore.getState().reiniciarSocial(); });
}

describe('useModalA11y · los diez overlays que faltaban', () => {
  beforeEach(limpiarSocial);
  afterEach(cerrarSocial);

  OVERLAYS.forEach(({ nombre, crear, cerrar }) => {
    it(nombre + ': es un dialogo, Escape cierra y el foco vuelve al abridor', async () => {
      const user = userEvent.setup();
      render(<Sobrecapa crear={crear} />);
      const abrir = screen.getByRole('button', { name: 'Abrir' });
      await user.click(abrir);

      const dialogo = screen.getByRole('dialog');
      expect(dialogo).toHaveAttribute('aria-modal', 'true');
      // El foco entra en el diálogo, no se queda detrás.
      expect(dialogo.contains(document.activeElement)).toBe(true);

      fireEvent.keyDown(document.activeElement, { key: 'Escape' });

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(abrir);
    });

    it(nombre + ': su boton de cerrar tiene nombre accesible', async () => {
      const user = userEvent.setup();
      render(<Sobrecapa crear={crear} />);
      await user.click(screen.getByRole('button', { name: 'Abrir' }));

      // lucide-react no marca sus SVG como decorativos, así que un <button> con
      // sólo un <X/> dentro se anunciaba sin nombre. Cinco estaban así y otros
      // tres decían «Cancelar» para cerrar.
      const boton = screen.getByRole('button', { name: cerrar });
      expect(boton).toBeInTheDocument();
      await user.click(boton);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it(nombre + ': nada dentro usa el atributo disabled', async () => {
      const user = userEvent.setup();
      render(<Sobrecapa crear={crear} />);
      await user.click(screen.getByRole('button', { name: 'Abrir' }));

      // Regla transversal del contrato: `disabled` saca del orden de tabulación
      // y deja al botón sin nombre que leer, justo cuando el jugador necesita
      // saber POR QUÉ no puede pulsarlo. Se usa `aria-disabled` y se rechaza en
      // el manejador. Los títulos bloqueados del perfil y las misiones a medias
      // eran los dos que quedaban.
      expect(screen.getByRole('dialog').querySelector('[disabled]')).toBeNull();
    });
  });

  it('el dialogo se nombra por su titulo, no por un texto suelto', async () => {
    const user = userEvent.setup();
    render(<Sobrecapa crear={(fin) => <LeaderboardModal onClose={fin} />} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(screen.getByRole('dialog', { name: 'Clasificación' })).toBeInTheDocument();
  });
});

describe('ReplayModal · deja de colgar del perfil', () => {
  beforeEach(limpiarSocial);
  afterEach(cerrarSocial);

  // El cierre del perfil es un espía: el fallo que esto vigila no es visual,
  // es que el clic del fondo de la repetición LLEGABA al onClose del perfil.
  const conHistorial = async () => {
    const user = userEvent.setup();
    const cerrarPerfil = vi.fn();
    render(<ProfileModal name="Yo" onClose={cerrarPerfil} />);
    await act(async () => {
      socket.recibir('match_history_data', [
        { id: 'm1', winner_id: 'p_cuenta', final_scores: [{ id: 'p_cuenta', name: 'Yo', score: 100 }], played_at: null }
      ]);
    });
    await user.click(screen.getByRole('button', { name: /Ver/ }));
    return { user, cerrarPerfil };
  };

  it('sale por portal, fuera de la sobrecapa del perfil', async () => {
    await conHistorial();

    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(2);
    const repeticion = document.querySelector('.ov-repeticion');
    expect(repeticion).toBeInTheDocument();
    // Ni en el DOM (portal) ni en el árbol de React (hermano) cuelga del perfil:
    // por ahí burbujeaba el clic que cerraba los dos.
    expect(repeticion.closest('.profile-card')).toBeNull();
    // Y el portal se afirma por separado, porque arregla otra cosa que el
    // parentesco de React no toca: dentro de la tarjeta del perfil heredaba su
    // `overflow: hidden` y el tablero reconstruido salía recortado.
    expect(repeticion.closest('.modal-overlay').parentElement).toBe(document.body);
  });

  it('un clic en SU fondo no se lleva por delante el perfil', async () => {
    const { user, cerrarPerfil } = await conHistorial();

    const fondoRepeticion = document.querySelector('.ov-repeticion').closest('.modal-overlay');
    await user.click(fondoRepeticion);

    expect(document.querySelector('.ov-repeticion')).toBeNull();
    expect(document.querySelector('.profile-card')).toBeInTheDocument();
    // La clave: el evento sintético de React burbujea por el ÁRBOL, portal
    // incluido, así que sacarla del DOM no bastaba. Tiene que ser hermana.
    expect(cerrarPerfil).not.toHaveBeenCalled();
  });
});

describe('FriendsModal · la pestana se reconcilia con los datos', () => {
  beforeEach(limpiarSocial);
  afterEach(cerrarSocial);

  const datos = (requests) => act(() => socket.recibir('friends_data', {
    friends: [{ id: 'p_ana', username: 'Ana', online: true, elo: 1300 }],
    requests
  }));

  it('aceptar la ultima solicitud deja una pestana activa CON contenido', async () => {
    const user = userEvent.setup();
    render(<FriendsModal name="Yo" onClose={() => {}} />);
    await datos([{ id: 'p_luis', username: 'Luis' }]);

    await user.click(screen.getByRole('button', { name: /Solicitudes \(1\)/ }));
    expect(screen.getByRole('button', { name: /Solicitudes \(1\)/ })).toHaveAttribute('aria-pressed', 'true');

    // Aceptar: el servidor contesta con la lista ya sin solicitudes y la pestaña
    // en la que estábamos deja de renderizarse. Antes quedaban 180 px en blanco
    // sin pestaña activa y sin más salida que cerrar el modal.
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    await datos([]);

    expect(screen.queryByRole('button', { name: /Solicitudes/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Tus amigos \(1\)/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('el vacio explica que pasa y ofrece la accion siguiente', async () => {
    render(<FriendsModal name="Yo" onClose={() => {}} />);
    await act(() => socket.recibir('friends_data', { friends: [], requests: [] }));

    expect(screen.getByText('Aún no tienes amigos. ¡Comparte tu código!')).toBeInTheDocument();
    // La salida es un botón de verdad, no una sugerencia en gris.
    expect(screen.getByRole('button', { name: /Copiar mi código/ })).toBeInTheDocument();
  });

  it('quitar a un amigo se confirma EN LINEA, no al primer clic', async () => {
    const user = userEvent.setup();
    render(<FriendsModal name="Yo" onClose={() => {}} />);
    await datos([]);

    socket.limpiarEmitidos();
    await user.click(screen.getByRole('button', { name: 'Quitar a Ana' }));
    // El primer clic NO borra: abre la confirmación en su sitio.
    expect(socket.emitidos('friend_remove')).toHaveLength(0);

    const confirmar = screen.getByRole('group', { name: 'Quitar a Ana' });
    expect(confirmar).toHaveClass('ov-confirmar');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(socket.emitidos('friend_remove')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Quitar a Ana' }));
    await user.click(screen.getByRole('button', { name: 'Quitar a Ana' }));
    expect(socket.emitidos('friend_remove')).toHaveLength(1);
    expect(socket.ultimoEmitido('friend_remove').otherId).toBe('p_ana');
  });
});

describe('Modo degradado · una sola bandera para todas las pantallas', () => {
  beforeEach(limpiarSocial);
  afterEach(cerrarSocial);

  const sinBaseDeDatos = () => setGameStore({
    capacidades: { persistencia: false, turnMode: 'free-fallback', amigos: false }
  });

  it('el perfil deja de inventar 1200 ELO y 500 monedas', () => {
    sinBaseDeDatos();
    render(<ProfileModal name="Yo" onClose={() => {}} />);

    expect(screen.getByText(/— ELO/)).toBeInTheDocument();
    expect(screen.queryByText(/500/)).toBeNull();
    expect(screen.queryByText(/1200/)).toBeNull();
    expect(document.querySelector('.ov-degradado').textContent)
      .toContain('Este servidor no guarda progreso');
  });

  it('la tienda dice lo MISMO del mismo monedero, y sigue siendo un escaparate', () => {
    sinBaseDeDatos();
    render(<SkinStoreModal playerId="p_cuenta" name="Yo" onClose={() => {}} />);

    // Ni 0 (lo que decía la tienda) ni 500 (lo que decía el perfil): «—».
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(document.querySelector('.ov-degradado').textContent)
      .toContain('No se pueden comprar objetos en este servidor');
    // El catálogo se puede mirar: ni spinner eterno ni muro de candados.
    expect(screen.getByText('Dragón Dorado')).toBeInTheDocument();
    expect(screen.queryByText('Cargando tu inventario…')).toBeNull();
  });

  it('la agenda no pinta un codigo que no existe ni ofrece copiarlo', () => {
    sinBaseDeDatos();
    render(<FriendsModal name="Yo" onClose={() => {}} />);

    // '·····' con un botón que anunciaba «¡Copiado!» tras copiar la cadena vacía.
    expect(screen.queryByText('·····')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copiar código' })).toBeNull();
    const franja = document.querySelector('.ov-degradado').textContent;
    expect(franja).toContain('Este servidor no guarda la lista de amigos');
    expect(franja).toContain('Puedes llamar a los jugadores de tu mesa');
  });

  it('el ranking dice por que esta vacio y ofrece la salida', async () => {
    sinBaseDeDatos();
    render(<LeaderboardModal onClose={() => {}} />);
    await act(async () => { socket.recibir('leaderboard_data', []); });

    expect(document.querySelector('.ov-degradado').textContent)
      .toContain('Este servidor no guarda el ranking');
    expect(screen.getByRole('button', { name: 'Jugar' })).toBeInTheDocument();
  });
});

describe('El vigilante de los 6 segundos', () => {
  beforeEach(limpiarSocial);
  afterEach(cerrarSocial);

  /**
   * `roomHandler` aborta en silencio cuando la identidad no quedó vinculada: la
   * petición se acepta y no llega respuesta NUNCA. La tienda apagaba su
   * `loading` únicamente dentro de `profile_data`, así que giraba
   * indefinidamente y no había ningún evento de error que pudiera apagarlo.
   */
  it('con un profile_data que no llega nunca, la tienda sale del spinner y ofrece reintentar', () => {
    vi.useFakeTimers();
    try {
      render(<SkinStoreModal playerId="p_cuenta" name="Yo" onClose={() => {}} />);
      expect(screen.getByText('Cargando tu inventario…')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(ESPERA_MAXIMA_MS + 10); });

      expect(screen.queryByText('Cargando tu inventario…')).toBeNull();
      expect(screen.getByText('No hemos podido cargar tus datos')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
      // Y el catálogo se ve igualmente: el fallo no borra la tienda.
      expect(screen.getByText('Dragón Dorado')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('si los datos llegan a tiempo, el vigilante no dice nada', async () => {
    render(<SkinStoreModal playerId="p_cuenta" name="Yo" onClose={() => {}} />);
    await act(async () => { socket.recibir('profile_data', { coins: 320 }); });

    await waitFor(() => expect(screen.getByText('320')).toBeInTheDocument());
    expect(screen.queryByText('No hemos podido cargar tus datos')).toBeNull();
  });
});

describe('useSocialStore · un solo suscriptor que no se desmonta', () => {
  beforeEach(limpiarSocial);
  afterEach(cerrarSocial);

  it('la lista de amigos SOBREVIVE a cerrar el modal', async () => {
    const { unmount } = render(<FriendsModal name="Yo" onClose={() => {}} />);
    await act(async () => {
      socket.recibir('friends_data', { friends: [{ id: 'p_ana', username: 'Ana', online: true }], requests: [] });
    });
    expect(screen.getByText('Ana')).toBeInTheDocument();
    unmount();

    // Con el modal cerrado siguen llegando los cambios: antes se registraban al
    // montar y se retiraban al cerrar, así que la lista se perdía entera y con
    // ella cualquier solicitud entrante.
    act(() => {
      socket.recibir('friends_data', {
        friends: [{ id: 'p_ana', username: 'Ana', online: true }, { id: 'p_luis', username: 'Luis', online: false }],
        requests: []
      });
    });
    expect(useSocialStore.getState().amigos).toHaveLength(2);

    render(<FriendsModal name="Yo" onClose={() => {}} />);
    expect(screen.getByText('Luis')).toBeInTheDocument();
  });

  it('tres pantallas sociales abiertas dejan UN listener por evento', () => {
    render(
      <>
        <FriendsModal name="Yo" onClose={() => {}} />
        <ProfileModal name="Yo" onClose={() => {}} />
        <SkinStoreModal playerId="p_cuenta" name="Yo" onClose={() => {}} />
      </>
    );

    for (const evento of ['friends_data', 'profile_data', 'friend_presence', 'friend_action']) {
      expect(socket.listeners(evento), 'evento ' + evento).toBe(1);
    }
  });

  it('friend_presence actualiza la fila que le toca y solo esa', async () => {
    render(<FriendsModal name="Yo" onClose={() => {}} />);
    await act(async () => {
      socket.recibir('friends_data', {
        friends: [{ id: 'p_ana', username: 'Ana', online: false }, { id: 'p_luis', username: 'Luis', online: false }],
        requests: []
      });
    });

    act(() => socket.recibir('friend_presence', { id: 'p_luis', online: true, actividad: { estado: 'jugando' } }));

    const { amigos } = useSocialStore.getState();
    expect(amigos.find((a) => a.id === 'p_luis').online).toBe(true);
    expect(amigos.find((a) => a.id === 'p_ana').online).toBe(false);
  });
});
