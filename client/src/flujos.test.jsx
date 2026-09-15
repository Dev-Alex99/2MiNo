import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useHubStore } from './hub/stores/useHubStore';
import { useGameStore } from './store/useGameStore';
import { useSocialStore } from './social/useSocialStore';
import { render, resetStores, setGameStore, setHubStore } from './test/utils';

const socket = globalThis.__socket;

/**
 * `ESTADO_LIMPIO` de test/utils.jsx todavía no declara `salaFantasma` ni
 * `sesionNoVerificada`, y `setState` de zustand MEZCLA: una bandera encendida
 * por un caso sobrevive a `resetStores()` y contamina el siguiente en verde y
 * en silencio. Se apagan a mano hasta que el arnés las declare (es el mismo
 * apaño que dejaron P2 y P3 en sus ficheros).
 *
 * Y el store social tampoco lo toca el arnés: la lista de amigos es de la
 * SESIÓN y no de la pantalla, así que sobrevive a `resetStores()` a propósito.
 * Sin este reinicio, la agenda de un caso salía en el carril del siguiente.
 */
function reiniciar() {
  resetStores();
  setGameStore({ salaFantasma: '', sesionNoVerificada: false });
  useSocialStore.getState().reiniciarSocial();
}

/** Tabula hasta llegar al nodo pedido. Devuelve si lo alcanzó. */
async function tabularHasta(usuario, nodo, tope = 30) {
  for (let i = 0; i < tope; i++) {
    if (document.activeElement === nodo) return true;
    await usuario.tab();
  }
  return document.activeElement === nodo;
}

function amigo(id, username, estado, extra = {}) {
  return {
    id,
    username,
    online: estado !== 'desconectado',
    actividad: { estado, roomId: null },
    ...extra
  };
}

/**
 * Flujos de punta a punta del hub multijuego.
 *
 * Existe por un fallo concreto: pulsar "Tres en Raya" en el hub te metía en el
 * dominó. El id del juego se fijaba bien, pero de ahí en adelante TODO asumía
 * dominó — el lobby, las listas de salas, la clasificatoria y los torneos— y el
 * `gameType` sólo llegaba al servidor al crear la sala.
 */

function salaTicTacToe(extra = {}) {
  return {
    gameType: 'tictactoe',
    roomId: 'ABCD',
    status: 'waiting',
    maxPlayers: 2,
    hostId: 'p_test',
    board: Array(9).fill(null),
    players: [{ id: 'p_test', name: 'Yo', isBot: false, ready: false, score: 0 }],
    ...extra
  };
}

describe('Flujo hub → juego', () => {
  beforeEach(() => reiniciar());

  it('elegir un juego en el hub deja el lobby DE ESE juego, no el del dominó', async () => {
    const usuario = userEvent.setup();
    render(<App />);

    await usuario.click(screen.getByText('Tres en Raya'));

    expect(useHubStore.getState().selectedGameId).toBe('tictactoe');
    // El título del lobby es el del juego elegido.
    expect(screen.getByRole('heading', { name: /Tres en Raya/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Domin/i })).toBeNull();
  });

  it('el lobby del dominó sí muestra su nombre', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(screen.getByText('Dominó Online'));
    expect(screen.getByRole('heading', { name: /Dominó Online/i })).toBeInTheDocument();
  });

  /**
   * Las opciones (variante doble 6/9, parejas, poderes, blitz) son del dominó.
   * Ofrecerlas en otro juego era engañoso: se mandaban y el servidor las ignora.
   */
  it('las opciones de sala sólo salen en los juegos que las tienen', async () => {
    const usuario = userEvent.setup();
    render(<App />);

    await usuario.click(screen.getByText('Dominó Online'));
    expect(document.querySelector('.options-summary')).toBeInTheDocument();

    act(() => setHubStore({ selectedGameId: 'tictactoe' }));
    expect(document.querySelector('.options-summary')).toBeNull();
  });

  /**
   * En el servidor la cola por ELO y los torneos hacen `new DominoGame`: desde
   * el tres en raya esos botones te metían literalmente en otro juego.
   */
  it('clasificatoria y torneo no se ofrecen en juegos que no los soportan', () => {
    setHubStore({ selectedGameId: 'domino' });
    const { rerender } = render(<App />);
    expect(document.querySelector('.ranked-find-btn')).toBeInTheDocument();
    expect(document.querySelector('.tournament-btn-highlight')).toBeInTheDocument();

    act(() => setHubStore({ selectedGameId: 'tictactoe' }));
    rerender(<App />);
    expect(document.querySelector('.ranked-find-btn')).toBeNull();
    expect(document.querySelector('.tournament-btn-highlight')).toBeNull();
  });
});

describe('Flujo lobby → listas de salas', () => {
  beforeEach(() => reiniciar());

  /**
   * `publicRoomsList(gameTypeFilter)` aceptaba el filtro desde siempre y nunca
   * se le pasaba: el lobby del tres en raya listaba salas de dominó.
   */
  it('se pide el listado DEL juego elegido', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    act(() => socket.recibir('connect'));

    await usuario.click(screen.getByText('Tres en Raya'));
    expect(socket.ultimoEmitido('lobby_subscribe')).toEqual({ gameType: 'tictactoe' });
  });

  it('cambiar de juego vuelve a suscribirse al listado correcto', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    act(() => socket.recibir('connect'));

    await usuario.click(screen.getByText('Tres en Raya'));
    act(() => useHubStore.getState().returnToHub());
    await usuario.click(screen.getByText('Dominó Online'));

    expect(socket.ultimoEmitido('lobby_subscribe')).toEqual({ gameType: 'domino' });
  });
});

describe('Flujo crear sala', () => {
  beforeEach(() => reiniciar());

  it('la sala se crea con el juego elegido', async () => {
    const usuario = userEvent.setup();
    setGameStore({ name: 'Ana' });
    render(<App />);

    await usuario.click(screen.getByText('Tres en Raya'));
    await usuario.click(screen.getByRole('button', { name: /Crear Nueva Sala/i }));

    expect(socket.ultimoEmitido('create_room').gameType).toBe('tictactoe');
  });
});

describe('Flujo entrar en una sala de otro juego', () => {
  beforeEach(() => reiniciar());

  /**
   * Por enlace de invitación, código de un amigo o reconexión puedes acabar en
   * una sala de un juego distinto al elegido. Si el hub no se entera, al salir
   * de la partida vuelves al lobby equivocado.
   */
  it('el juego seleccionado se sincroniza con la partida en curso', () => {
    setHubStore({ selectedGameId: 'domino' });
    render(<App />);

    act(() => setGameStore({ roomId: 'ABCD', gameState: salaTicTacToe() }));

    expect(useHubStore.getState().selectedGameId).toBe('tictactoe');
  });

  it('la sala de espera no anuncia modalidades de dominó en otro juego', () => {
    setHubStore({ selectedGameId: 'tictactoe' });
    setGameStore({ roomId: 'ABCD', gameState: salaTicTacToe() });
    render(<App />);

    const etiquetas = document.querySelector('.room-mode-tags');
    expect(etiquetas).toBeInTheDocument();
    expect(etiquetas.textContent).not.toMatch(/Doble/i);
    expect(etiquetas.textContent).not.toMatch(/puntos/i);
    expect(etiquetas.textContent).toMatch(/Tres en Raya/);
  });

  /**
   * La mesa se pintaba SIEMPRE de cuatro: tres ranuras vacías en una sala de
   * tres en raya (2 plazas), contador "1/4" —el 4 estaba dentro de la propia
   * traducción— y el botón de añadir bot activo con la sala ya llena.
   */
  it('la sala de espera muestra el aforo REAL del juego, no cuatro plazas', () => {
    setHubStore({ selectedGameId: 'tictactoe' });
    setGameStore({ roomId: 'ABCD', gameState: salaTicTacToe() });
    render(<App />);

    // 1 sentado + 1 hueco = 2 plazas, no 4.
    expect(document.querySelectorAll('.player-row-empty')).toHaveLength(1);
    expect(document.querySelector('.waiting-players-header').textContent).toMatch(/1\/2/);
    expect(document.querySelector('.waiting-players-header').textContent).not.toMatch(/\/4/);
  });

  it('con la mesa llena no se puede añadir otro bot', () => {
    setHubStore({ selectedGameId: 'tictactoe' });
    setGameStore({
      roomId: 'ABCD',
      gameState: salaTicTacToe({
        players: [
          { id: 'p_test', name: 'Yo', isBot: false, ready: false, score: 0 },
          { id: 'p_bot', name: 'Bot', isBot: true, ready: true, score: 0 }
        ]
      })
    });
    render(<App />);

    expect(document.querySelectorAll('.player-row-empty')).toHaveLength(0);
    expect(document.querySelector('.bot-add-btn')).toBeDisabled();
  });

  it('el dominó conserva sus cuatro plazas', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({
      roomId: 'WXYZ',
      gameState: {
        gameType: 'domino', roomId: 'WXYZ', status: 'waiting', maxPlayers: 4,
        maxPip: 6, maxScore: 100, powersEnabled: false, teamsEnabled: false,
        hostId: 'p_test', board: [],
        players: [{ id: 'p_test', name: 'Yo', isBot: false, ready: false, score: 0, hand: [] }]
      }
    });
    render(<App />);
    expect(document.querySelectorAll('.player-row-empty')).toHaveLength(3);
    expect(document.querySelector('.waiting-players-header').textContent).toMatch(/1\/4/);
  });

  it('en dominó sí las anuncia', () => {
    setHubStore({ selectedGameId: 'domino' });
    setGameStore({
      roomId: 'WXYZ',
      gameState: {
        gameType: 'domino', roomId: 'WXYZ', status: 'waiting', maxPlayers: 4,
        maxPip: 6, maxScore: 100, powersEnabled: false, teamsEnabled: false,
        hostId: 'p_test', board: [],
        players: [{ id: 'p_test', name: 'Yo', isBot: false, ready: false, score: 0, hand: [] }]
      }
    });
    render(<App />);
    expect(document.querySelector('.room-mode-tags').textContent).toMatch(/Doble/i);
  });
});

/**
 * El vestíbulo dejó de ser un folleto.
 *
 * Los tres defectos que estos casos fijan, y que estaban medidos: la acción
 * principal de la pantalla principal era un `<div onClick>` sin `role`, sin
 * `tabIndex` y sin `onKeyDown` —no existía para el teclado— con tres botones
 * interiores idénticos llamados «Jugar»; las dos cifras mentían (`|| 1` afirmaba
 * un jugador aunque el servidor dijera cero, y las salas se contaban sobre la
 * lista ya filtrada por juego); y llegar por enlace de invitación aterrizaba en
 * un hub que no sabía que había una sala esperando.
 */
describe('Vestíbulo · el catálogo es alcanzable con el teclado', () => {
  beforeEach(() => reiniciar());

  it('la tarjeta es un botón de verdad y se elige con Tab y Enter', async () => {
    const usuario = userEvent.setup();
    render(<App />);

    const tarjeta = screen.getByRole('button', { name: 'Jugar a Tres en Raya' });
    expect(await tabularHasta(usuario, tarjeta)).toBe(true);
    await usuario.keyboard('{Enter}');

    expect(useHubStore.getState().selectedGameId).toBe('tictactoe');
  });

  it('el nombre accesible de cada tarjeta lleva el título de SU juego', () => {
    render(<App />);

    // Antes las tres se anunciaban «Jugar», sin relación con el título que
    // tenían 40 px por encima.
    expect(screen.getByRole('button', { name: 'Jugar a Dominó Online' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jugar a Tres en Raya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jugar a Uno' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jugar' })).toBeNull();
  });

  it('la rejilla sale del registro de tableros y los que no existen bajan al pie', () => {
    render(<App />);

    // Tres tarjetas, no cinco: Ludo y Ajedrez ocupaban 2 de 5 posiciones con un
    // candado, y en 375 px eso es una ranura entera por promesa.
    expect(document.querySelectorAll('.vest-tarjeta')).toHaveLength(3);
    const pie = document.querySelector('.vest-proximamente');
    expect(pie.textContent).toMatch(/Ludo Star/);
    expect(pie.textContent).toMatch(/Ajedrez Blitz/);
  });

  it('la línea de capacidades dice lo que el lobby luego ofrece', () => {
    render(<App />);

    const domino = screen.getByRole('button', { name: 'Jugar a Dominó Online' });
    expect(domino.textContent).toMatch(/2-4 jugadores/);
    expect(domino.textContent).toMatch(/parejas/);
    expect(domino.textContent).toMatch(/torneos/);

    // El tres en raya es de dos y no tiene ni parejas ni torneos: ofrecérselos
    // era meterle en una partida de dominó.
    const raya = screen.getByRole('button', { name: 'Jugar a Tres en Raya' });
    expect(raya.textContent).toMatch(/2 jugadores/);
    expect(raya.textContent).not.toMatch(/parejas/);
    expect(raya.textContent).not.toMatch(/torneos/);
  });
});

describe('Vestíbulo · las métricas dicen la verdad', () => {
  beforeEach(() => reiniciar());

  const cifras = () => [...document.querySelectorAll('.vest-cifra-valor')].map(n => n.textContent.trim());

  it('con cero jugadores dice 0, no 1', () => {
    setGameStore({ isConnected: true, lobbyStats: { online: 0, playing: 0, openRooms: 0 } });
    render(<App />);

    expect(cifras()).toEqual(['0', '0', '0']);
  });

  it('sin conexión las tres cifras son «—» y el punto deja de latir', () => {
    setGameStore({ isConnected: false, lobbyStats: { online: 47, playing: 12, openRooms: 6 } });
    render(<App />);

    expect(cifras()).toEqual(['—', '—', '—']);
    expect(document.querySelector('.vest-cifra-valor.viva')).toBeNull();
    expect(document.querySelector('.vest-pulso-nota')).toBeInTheDocument();
  });

  it('las salas abiertas salen del servidor, no de la lista ya filtrada por juego', () => {
    // `publicRooms` sólo trae las del juego suscrito (el hub se suscribe a
    // dominó), así que contarlas hacía que el catálogo multijuego enseñara las
    // salas de UN juego. `lobbyStats.openRooms` viene sin filtrar.
    setGameStore({
      isConnected: true,
      lobbyStats: { online: 47, playing: 12, openRooms: 6 },
      publicRooms: [{ roomId: 'AAAA' }, { roomId: 'BBBB' }]
    });
    render(<App />);

    expect(cifras()).toEqual(['47', '12', '6']);
  });
});

describe('Vestíbulo · la invitación y la sala a medias', () => {
  beforeEach(() => reiniciar());

  it('con un código de invitación el hub lo dice y deja entrar sin salir de aquí', async () => {
    const usuario = userEvent.setup();
    setGameStore({ invitedCode: 'WXYZ', isConnected: true });
    render(<App />);

    const banda = document.querySelector('.vest-invitacion');
    expect(banda).toBeInTheDocument();
    expect(banda.textContent).toMatch(/WXYZ/);

    await usuario.type(within(banda).getByRole('textbox'), 'Ana');
    await usuario.click(within(banda).getByRole('button'));

    expect(socket.ultimoEmitido('join_room')).toMatchObject({ roomId: 'WXYZ', name: 'Ana' });
  });

  it('la sala que sigue viva ofrece volver, y no coincide con la fantasma', async () => {
    const usuario = userEvent.setup();
    setGameStore({ roomId: 'ABCD', name: 'Ana', isConnected: true });
    render(<App />);

    const banda = document.querySelector('.vest-reanudar-viva');
    expect(banda.textContent).toMatch(/ABCD/);
    await usuario.click(within(banda).getByRole('button'));
    expect(socket.ultimoEmitido('join_room')).toMatchObject({ roomId: 'ABCD' });

    // Cuando se enciende la sala FANTASMA, `roomId` ya se ha vaciado a
    // propósito: las dos bandas no pueden pintarse a la vez.
    act(() => setGameStore({ roomId: '', salaFantasma: 'ABCD' }));
    expect(document.querySelector('.vest-reanudar-viva')).toBeNull();
  });
});

describe('Vestíbulo · el carril de gente', () => {
  beforeEach(() => reiniciar());

  const llegaLaAgenda = (friends) => act(() => socket.recibir('friends_data', { friends, requests: [] }));

  it('el nombre accesible dice lo que cuesta llamar a cada uno', () => {
    render(<App />);
    llegaLaAgenda([
      amigo('p_marta', 'Marta', 'libre'),
      amigo('p_luis', 'Luis', 'jugando'),
      amigo('p_ana', 'Ana', 'en_llamada'),
      amigo('p_leo', 'Leo', 'no_molestar')
    ]);

    expect(screen.getByRole('button', { name: 'Llamar a Marta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Llamar a Luis · Jugando' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir entrar a la llamada de Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leo no quiere que le llamen ahora' })).toBeInTheDocument();
  });

  it('quien no quiere que le llamen no abre acciones, y no lleva `disabled`', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    llegaLaAgenda([amigo('p_leo', 'Leo', 'no_molestar')]);

    const boton = screen.getByRole('button', { name: 'Leo no quiere que le llamen ahora' });
    // PROHIBIDO el atributo `disabled`: un botón deshabilitado sale del
    // recorrido de teclado y no puede explicar por qué no se puede pulsar.
    expect(boton).not.toBeDisabled();
    expect(boton).toHaveAttribute('aria-disabled', 'true');

    await usuario.click(boton);
    expect(document.querySelector('.vest-persona-acciones')).toBeNull();
  });

  it('los desconectados no salen del carril y delante va a quien puedes llamar', () => {
    render(<App />);
    llegaLaAgenda([
      amigo('p_luis', 'Luis', 'jugando'),
      amigo('p_zoe', 'Zoe', 'desconectado'),
      amigo('p_ana', 'Ana', 'en_llamada'),
      amigo('p_marta', 'Marta', 'libre')
    ]);

    const nombres = [...document.querySelectorAll('.vest-persona-nombre')].map(n => n.textContent);
    expect(nombres).toEqual(['Ana', 'Marta', 'Luis']);
    expect(screen.queryByText('Zoe')).toBeNull();
  });

  it('se llama desde el carril, con las flechas y sin abrir ningún modal', async () => {
    const usuario = userEvent.setup();
    setGameStore({ name: 'Yo' });
    render(<App />);
    llegaLaAgenda([amigo('p_marta', 'Marta', 'libre'), amigo('p_luis', 'Luis', 'libre')]);

    // Van ordenados por estado y luego por nombre: Luis antes que Marta.
    const luis = screen.getByRole('button', { name: 'Llamar a Luis' });
    const marta = screen.getByRole('button', { name: 'Llamar a Marta' });
    // Roving tabindex: sólo UNO de los dos entra en el orden de tabulación.
    expect([luis, marta].filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);

    act(() => luis.focus());
    await usuario.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(marta);

    await usuario.keyboard('{Home}');
    expect(document.activeElement).toBe(luis);

    await usuario.keyboard('{Enter}');
    await usuario.click(screen.getByRole('button', { name: 'Retar' }));
    expect(socket.ultimoEmitido('friend_challenge')).toMatchObject({ friendId: 'p_luis' });
  });

  it('sin persistencia el carril lo dice, y no pide una agenda que no existe', () => {
    setGameStore({ capacidades: { persistencia: false, turnMode: 'free-fallback', amigos: false } });
    render(<App />);

    expect(document.querySelector('.vest-carril .ov-degradado')).toBeInTheDocument();
    expect(socket.emitidos('get_friends')).toHaveLength(0);
  });

  /**
   * La lista de amigos es UNA. El carril no guarda su propia copia: lee y
   * escribe el store social, que es el dueño que le asigna el contrato §6.
   * Con dos copias, abrir la lista de amigos encima del hub dejaba dos
   * versiones del mismo dato divergiendo en cuanto una se perdiera un evento.
   */
  it('el carril no guarda una segunda copia: lee del store social', () => {
    render(<App />);
    llegaLaAgenda([amigo('p_marta', 'Marta', 'libre')]);

    expect(useSocialStore.getState().amigos).toHaveLength(1);
    expect(useSocialStore.getState().amigos[0].username).toBe('Marta');

    // Y un cambio escrito en el store se ve en el carril sin pasar por socket.
    act(() => useSocialStore.setState({ amigos: [] }));
    expect(screen.queryByRole('button', { name: 'Llamar a Marta' })).toBeNull();
  });

  it('las solicitudes pendientes se ven en el botón de Amigos', () => {
    render(<App />);
    act(() => socket.recibir('friends_data', { friends: [], requests: [{ id: 'p_x', username: 'X' }] }));

    expect(screen.getByRole('button', { name: /solicitudes pendientes/ })).toBeInTheDocument();
    expect(document.querySelector('.vest-nav-insignia').textContent).toBe('1');
  });
});

describe('Vestíbulo · el hub habla el idioma del jugador', () => {
  beforeEach(() => reiniciar());

  it('el hub monta el selector de idioma, y cambiarlo traduce la pantalla', async () => {
    const usuario = userEvent.setup();
    render(<App />);

    // Era la ÚNICA pantalla sin selector: un jugador en portugués no podía
    // cambiar de idioma hasta entrar en un juego.
    const selector = document.querySelector('.vest-barra .lang-switcher');
    expect(selector).toBeInTheDocument();

    await usuario.click(within(selector).getByRole('button'));
    await usuario.click(screen.getByRole('option', { name: /English/ }));

    expect(screen.getByRole('button', { name: 'Play Dominó Online' })).toBeInTheDocument();
    // El nombre propio del juego NO se traduce (CONTRATO §10).
    expect(screen.getByText('Dominó Online')).toBeInTheDocument();
  });
});

describe('Lobby · la barra superior es alcanzable', () => {
  beforeEach(() => reiniciar());

  it('los siete controles tienen nombre accesible y ninguno queda mudo', async () => {
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(screen.getByText('Dominó Online'));

    const barra = document.querySelector('.lobby-topbar');
    const botones = within(barra).getAllByRole('button');
    // Hub, Tienda, Torneo, Ranking, Amigos, Perfil e Idioma.
    expect(botones).toHaveLength(7);
    for (const boton of botones) {
      const nombre = boton.getAttribute('aria-label') || boton.textContent.trim();
      expect(nombre.length).toBeGreaterThan(0);
    }
  });

  it('la barra ya no lleva posicionamiento a mano en el JSX', () => {
    setHubStore({ selectedGameId: 'domino' });
    render(<App />);

    // jsdom no calcula layout, así que se afirma lo comprobable: los estilos en
    // línea con los que se pintaban los dos destacados han desaparecido (ahora
    // son clases con tokens) y la barra es un hijo más de la pantalla, no un
    // `position: absolute` sin `left` que arrancaba en x negativo.
    const barra = document.querySelector('.lobby-topbar');
    expect(barra.getAttribute('style')).toBeNull();
    for (const boton of barra.querySelectorAll('button')) {
      expect(boton.getAttribute('style')).toBeNull();
    }
  });
});

describe('Lobby · los estados vacíos tienen salida', () => {
  beforeEach(() => reiniciar());

  it('sin partidas en vivo la sección se ve igual, con su vacío y su salida', async () => {
    const usuario = userEvent.setup();
    setGameStore({ name: 'Ana', liveGames: [], roomsLoading: false, isConnected: true });
    render(<App />);
    await usuario.click(screen.getByText('Dominó Online'));

    // El estado vacío de LiveGames era inalcanzable por construcción: el lobby
    // montaba el componente sólo cuando había partidas.
    const vacio = screen.getByText(/No hay partidas en vivo/i).closest('.room-list-empty');
    expect(vacio).toBeInTheDocument();

    await usuario.click(within(vacio).getByRole('button'));
    expect(socket.emitidos('quick_play').length).toBeGreaterThan(0);
  });

  it('sin salas abiertas se puede crear una desde el propio vacío', async () => {
    const usuario = userEvent.setup();
    setGameStore({ name: 'Ana', isConnected: true });
    render(<App />);
    await usuario.click(screen.getByText('Dominó Online'));
    // Suscribirse al lobby vuelve a poner la lista en «buscando»: el vacío es
    // el que llega DEL SERVIDOR, no el de antes de preguntar.
    act(() => socket.recibir('rooms_list', []));

    const vacio = screen.getByText(/No hay salas abiertas/i).closest('.room-list-empty');
    await usuario.click(within(vacio).getByRole('button'));
    expect(socket.emitidos('create_room').length).toBeGreaterThan(0);
  });

  /**
   * «No hay salas» y «no lo sabemos» son cosas distintas y se decían igual. Sin
   * socket las dos listas se quedan vacías porque no ha llegado nada, y las dos
   * afirmaban que no había nada — la misma mentira que el contador que decía 1
   * jugador en línea con el servidor caído.
   */
  it('sin conexión las listas dicen que no lo saben, no que no hay nada', async () => {
    const usuario = userEvent.setup();
    setGameStore({ name: 'Ana', publicRooms: [], liveGames: [], roomsLoading: false, isConnected: false });
    render(<App />);
    await usuario.click(screen.getByText('Dominó Online'));

    expect(screen.queryByText(/No hay salas abiertas/i)).toBeNull();
    expect(screen.queryByText(/No hay partidas en vivo/i)).toBeNull();
    // Una por lista: la de salas y la de partidas en vivo.
    expect(screen.getAllByText(/Conexión perdida/i).length).toBeGreaterThanOrEqual(2);
  });
});

describe('El hub ya no guarda una segunda copia del catálogo', () => {
  beforeEach(() => reiniciar());

  it('useHubStore sólo lleva el juego elegido', () => {
    const estado = useHubStore.getState();
    expect(estado.availableGames).toBeUndefined();
    expect(Object.keys(estado).sort()).toEqual(['returnToHub', 'selectedGameId', 'setSelectedGameId']);
  });

  it('el arnés y el store siguen de acuerdo en las dos identidades', () => {
    const { cuentaId, playerId } = useGameStore.getState();
    expect(cuentaId).toBe('p_cuenta');
    expect(playerId).toBe('p_test');
  });
});
