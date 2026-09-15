import React, { useEffect, useRef, useState } from 'react';
import { socket } from './socket';
import { playGameSound } from './audio';
import { Wifi, AlertCircle } from 'lucide-react';

import Lobby from './components/Lobby';
import WaitingRoom from './components/WaitingRoom';
import SpectatorView from './components/SpectatorView';
import TournamentHub from './components/TournamentHub';
import TournamentEntry from './components/TournamentEntry';
import RankedSearch from './components/RankedSearch';
import FriendsModal from './components/FriendsModal';
import ProfileModal from './components/ProfileModal';
import LeaderboardModal from './components/LeaderboardModal';
import SkinStoreModal from './components/SkinStoreModal';
import GameView from './views/GameView';
import HubDashboard from './hub/HubDashboard';

import LineaGlobal from './voice/LineaGlobal';
import { VoiceProvider } from './voice/VoiceContext';
import { useT } from './i18n/LanguageContext';
import { renderError } from './i18n/format';
import { initTheme } from './theme';
import { useGameStore, getOrCreatePersistentPlayerId } from './store/useGameStore';
import { useHubStore } from './hub/stores/useHubStore';
import useGameSocket from './hooks/useGameSocket';
import useGameActions from './hooks/useGameActions';

function readInviteCode() {
  try {
    const path = window.location.pathname.replace(/^\/+/, '').trim();
    const params = new URLSearchParams(window.location.search);
    const raw = path || params.get('room') || params.get('code') || '';
    const code = raw.toUpperCase();
    return /^[A-Z]{4}$/.test(code) ? code : '';
  } catch {
    return '';
  }
}

/**
 * Orquestador: decide QUÉ vista se muestra y cablea las tres piezas
 * (escuchar → `useGameSocket`, emitir → `useGameActions`, pintar → las vistas).
 *
 * Antes esto eran 977 líneas con los ~21 listeners, los ~20 emisores, la lógica
 * de logros y momentos épicos, y el JSX de la partida entera, todo junto.
 *
 * REGLA DEL MARCO: no existe ninguna rama sin proveedor de voz, sin capa social
 * y sin modales. Todo lo que sobrevive a cambiar de pantalla —la línea, los
 * avisos, las invitaciones y los modales— vive AQUÍ, por encima del router; las
 * seis vistas sólo se turnan debajo. Antes el espectador retornaba por encima
 * del proveedor, así que ir a ver una partida desmontaba el motor de voz entero
 * (y con él los RTCPeerConnection, los <audio> del body y la pista del micro):
 * la llamada se cortaba por navegar, que es justo lo que no puede pasar.
 */
export default function App() {
  const { t } = useT();

  const {
    name, setName,
    cuentaId, playerId, roomId, gameState,
    error, isConnected,
    publicRooms, roomsLoading, lobbyStats,
    setShowTurnBanner, setRoomsLoading,
    showProfile, setShowProfile,
    spectating, liveGames, epicMoment, setEpicMoment, invitedCode, setInvitedCode,
    salaFantasma, setSalaFantasma, sesionNoVerificada
  } = useGameStore();

  // Hub multijuego: qué juego está seleccionado. DEBE llamarse aquí arriba,
  // junto al resto de hooks, nunca después de un return condicional (rompería
  // las Reglas de Hooks al entrar/salir del modo espectador).
  const { selectedGameId } = useHubStore();

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [showFriends, setShowFriends] = useState(false);

  const invitedCodeRef = useRef(invitedCode);
  invitedCodeRef.current = invitedCode;
  const autoJoinedRef = useRef(false);

  // Escuchar y emitir, cada uno en su hook.
  const net = useGameSocket({ invitedCodeRef });
  const actions = useGameActions({
    tournament: net.tournament,
    setTournament: net.setTournament,
    setShowTournamentEntry: net.setShowTournamentEntry,
    setSearchingRanked: net.setSearchingRanked,
    incomingInvite: net.incomingInvite,
    setIncomingInvite: net.setIncomingInvite,
    resetGameStatus: net.resetGameStatus
  });

  // ─── Efectos de arranque y ciclo de vida ───
  useEffect(() => {
    const code = readInviteCode();
    if (code) setInvitedCode(code);
  }, [setInvitedCode]);

  useEffect(() => {
    if (name) localStorage.setItem('domino_username', name);
  }, [name]);

  useEffect(() => { initTheme(); }, []);

  useEffect(() => {
    if (!epicMoment) return undefined;
    playGameSound('epic');
    const id = setTimeout(() => setEpicMoment(null), 4000);
    return () => clearTimeout(id);
  }, [epicMoment, setEpicMoment]);

  // Limpiar el código de invitación de la URL para que no se re-aplique al recargar.
  useEffect(() => {
    if (window.location.pathname !== '/' || window.location.search) {
      try { window.history.replaceState({}, '', '/'); } catch { /* noop */ }
    }
  }, []);

  // Entrada automática por enlace de invitación, una sola vez.
  useEffect(() => {
    if (!isConnected || !invitedCode || roomId || autoJoinedRef.current) return;
    if (name && name.trim()) {
      autoJoinedRef.current = true;
      socket.emit('join_room', { roomId: invitedCode, name: name.trim(), playerId: getOrCreatePersistentPlayerId() });
    }
  }, [isConnected, invitedCode, roomId, name]);

  // Suscripción al lobby DEL JUEGO seleccionado. Va en las dependencias: sin
  // ella, cambiar de juego en el hub dejaba al cliente escuchando el listado
  // del juego anterior (y entrando en salas que no eran del que había elegido).
  const inLobby = !spectating && (!gameState || !roomId);
  useEffect(() => {
    if (!isConnected || !inLobby) return undefined;
    setRoomsLoading(true);
    socket.emit('lobby_subscribe', { gameType: selectedGameId || 'domino' });
    return () => socket.emit('lobby_unsubscribe');
  }, [isConnected, inLobby, selectedGameId, setRoomsLoading]);

  // Si acabas entrando en una sala de otro juego (enlace de invitación, código
  // de un amigo, reconexión), el hub debe reflejarlo: si no, al salir de la
  // partida volverías al lobby de un juego distinto al que estabas jugando.
  const gameTypeEnCurso = gameState && gameState.gameType;
  useEffect(() => {
    if (gameTypeEnCurso && gameTypeEnCurso !== selectedGameId) {
      useHubStore.getState().setSelectedGameId(gameTypeEnCurso);
    }
  }, [gameTypeEnCurso, selectedGameId]);

  // Aviso de "es tu turno": sonido, vibración y cartel efímero.
  const isMyTurn = gameState
    ? (gameState.currentPlayerId === playerId && gameState.status === 'playing')
    : false;
  const prevIsMyTurnRef = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnRef.current) {
      setShowTurnBanner(true);
      playGameSound('turn_alert');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([120, 80, 120]); } catch (e) { /* noop */ }
      }
      const timer = setTimeout(() => setShowTurnBanner(false), 1600);
      return () => clearTimeout(timer);
    }
    prevIsMyTurnRef.current = isMyTurn;
    return undefined;
  }, [isMyTurn, setShowTurnBanner]);

  /**
   * Qué pantalla manda, decidido UNA vez y en un solo sitio.
   *
   * Antes eran un `return` anticipado más un ternario anidado de cinco ramas, y
   * la prioridad había que reconstruirla leyendo la anidación. El orden es el
   * mismo que había: espectar gana a todo (era el return de arriba), el torneo
   * gana al hub, y de ahí hacia abajo manda cuánto sabes de la sala.
   */
  const vista = spectating ? 'espectador'
    : net.tournament ? 'torneo'
      : !selectedGameId ? 'hub'
        : (!roomId || !gameState) ? 'lobby'
          : gameState.status === 'waiting' ? 'sala'
            : 'partida';

  // Las bandas del vestíbulo hablan de dónde estás y de qué sabe de ti el
  // servidor: dentro de una partida no significan nada, y además meterían una
  // segunda región viva en una pantalla que sólo admite tres.
  const enVestibulo = vista === 'hub' || vista === 'lobby';

  // [Reintentar] de la sala fantasma: se vuelve a pedir la sala por su código,
  // que es lo único que queda de ella (`onErrorMsg` ya vació sessionStorage).
  // Si tampoco existe ahora, el intento es indistinguible de teclear un código
  // a mano y el servidor contesta con su aviso rojo: la banda descartable es
  // para la sala que YO tenía guardada, y ya deja de estarlo.
  const reintentarSalaFantasma = () => {
    const codigo = salaFantasma;
    setSalaFantasma('');
    if (codigo) actions.handleJoinRoom(codigo);
  };

  // Los dos modales que abre cualquier pantalla, incluida la partida: el de
  // amigos es el único sitio de la aplicación desde el que se llama a alguien,
  // y hasta ahora sólo existía en el hub y en el lobby.
  const modalesSociales = (
    <>
      {showFriends && <FriendsModal name={name} onClose={() => setShowFriends(false)} />}
      {showProfile && <ProfileModal name={name} onClose={() => setShowProfile(false)} />}
    </>
  );

  // Ranking y tienda. Van aparte porque `GameView` monta ya su propia copia con
  // ESTE mismo estado (GameView.jsx:129-133): pintarlos también aquí durante la
  // partida apilaría dos overlays idénticos, y cerrar uno dejaría el otro. Se
  // suben aquí en cuanto GameView suelte los suyos.
  const modalesDeCatalogo = (
    <>
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}
      {showStore && (
        <SkinStoreModal playerId={cuentaId} name={name} onClose={() => setShowStore(false)} />
      )}
    </>
  );

  return (
    // El proveedor se queda en App y NO sube a main.jsx: mudarlo obligaría a
    // envolver el `render()` del banco de pruebas y a instanciar el motor de voz
    // —micro, pares, temporizadores— en los tests que no tienen nada que ver con
    // la voz. Recibe `cuentaId` (la PERSONA) y no `playerId` (el asiento, que
    // dentro de una sala es un alias `s_xxxx` y fuera es ''): el servidor indexa
    // las llamadas por cuenta, así que con el alias el filtro «este miembro no
    // soy yo» daba cierto también para uno mismo y se abría un par contra sí
    // mismo. Tampoco recibe ya `roomId`: la voz de la mesa se pide por su propio
    // evento y no se deduce de en qué pantalla estás.
    <VoiceProvider playerId={cuentaId} name={name}>
      <LineaGlobal hayVozEmbebida={vista === 'sala' || vista === 'partida'} />

      {/* Avisos GLOBALES: antes vivían dentro de la rama de partida, así que una
          caída de conexión o un error del servidor (sala llena, código inválido)
          era invisible en el lobby y el hub.
          Son dos de las TRES únicas cosas que pueden interrumpir con role=alert
          (la tercera son los avisos de reloj de la cinta). Como el nodo se monta
          y se desmonta con el aviso, sólo se anuncian al aparecer: al arrancar
          `isConnected` ya es false, así que ese primer render no interrumpe. */}
      {!isConnected && (
        <div className="network-alert" role="alert">
          <Wifi size={12} aria-hidden="true" />
          {t('net.lost')}
        </div>
      )}

      {error && (
        <div className="error-toast" role="alert">
          <AlertCircle size={12} aria-hidden="true" />
          {renderError(t, error)}
        </div>
      )}

      {/* La sala guardada que el servidor ya no tiene. Es `role="status"` y no
          `alert` a propósito: no es un error del jugador, es un aviso
          descartable. Hasta ahora este camino pintaba un toast rojo que volvía
          en CADA recarga, porque nadie borraba las claves de sessionStorage. */}
      {enVestibulo && salaFantasma && (
        <div className="vest-reanudar" role="status">
          <span>{t('hub.salaFantasma')}</span>
          <button type="button" className="btn-premium btn-secondary" onClick={() => setSalaFantasma('')}>
            {t('hub.olvidarSala')}
          </button>
          <button type="button" className="btn-premium btn-primary" onClick={reintentarSalaFantasma}>
            {t('degradado.reintentar')}
          </button>
        </div>
      )}

      {/* Modo invitado: el socket no quedó vinculado (base de datos caída,
          identidad ya reclamada, handshake fallido). Se puede jugar y hablar,
          pero nadie te ve ni te puede llamar. Era el peor de los modos
          degradados y no tenía ni un síntoma en pantalla. */}
      {enVestibulo && sesionNoVerificada && (
        <div className="ov-degradado" role="status">
          <span>{t('hub.sinSesion')}</span>
          <button type="button" className="btn-premium btn-secondary" onClick={net.reintentarSesion}>
            {t('hub.sinSesionReintentar')}
          </button>
        </div>
      )}

      {/* Router de vistas: espectador → torneo → hub → lobby → sala → partida.
          Cada una en su propia ranura y excluyentes por construcción, porque
          `vista` es un solo valor. */}
      {vista === 'espectador' && (
        gameState
          ? <SpectatorView gameState={gameState} onLeave={actions.handleLeaveSpectate} />
          : (
            <div className="app-container spectator spec-loading">
              <span>{t('spec.badge')}…</span>
            </div>
          )
      )}

      {vista === 'torneo' && (
        <TournamentHub
          tournament={net.tournament}
          onStart={actions.handleStartTournament}
          onPlayMatch={actions.handlePlayTournamentMatch}
          onExit={actions.handleExitTournament}
        />
      )}

      {vista === 'hub' && (
        <HubDashboard
          onOpenProfile={() => setShowProfile(true)}
          onOpenStore={() => setShowStore(true)}
          onOpenFriends={() => setShowFriends(true)}
          onOpenLeaderboard={() => setShowLeaderboard(true)}
        />
      )}

      {vista === 'lobby' && (
        <Lobby
          name={name}
          setName={setName}
          onCreateRoom={actions.handleCreateRoom}
          onJoinRoom={actions.handleJoinRoom}
          onQuickPlay={actions.handleQuickPlay}
          publicRooms={publicRooms}
          roomsLoading={roomsLoading}
          stats={lobbyStats}
          invitedCode={invitedCode}
          onOpenProfile={() => setShowProfile(true)}
          onOpenLeaderboard={() => setShowLeaderboard(true)}
          onOpenStore={() => setShowStore(true)}
          onOpenTournament={actions.handleOpenTournament}
          onFindRanked={actions.handleFindRanked}
          onOpenFriends={() => setShowFriends(true)}
          liveGames={liveGames}
          onSpectate={actions.handleSpectate}
        />
      )}

      {vista === 'sala' && (
        <WaitingRoom
          gameState={gameState}
          playerId={playerId}
          onLeave={actions.handleLeaveRoom}
        />
      )}

      {vista === 'partida' && (
        <GameView
          actions={actions}
          isMyTurn={isMyTurn}
          legendaryEffect={net.legendaryEffect}
          onCloseLegendary={() => net.setLegendaryEffect(null)}
          tournament={net.tournament}
          showLeaderboard={showLeaderboard}
          setShowLeaderboard={setShowLeaderboard}
          showStore={showStore}
          setShowStore={setShowStore}
        />
      )}

      {/* Capa social, GLOBAL. Vivía dentro de la rama del lobby, así que si un
          amigo te retaba mientras estabas en el hub, en la sala de espera, en la
          partida o espectando, el evento llegaba, `incomingInvite` se fijaba y
          no aparecía nada: la invitación se perdía y quien invitó se quedaba
          esperando solo en su sala. Es el mismo movimiento que la casa ya hizo
          con los dos avisos de arriba. Entran como `role="status"` y nunca como
          `alert`: los dos huecos de interrupción están gastados. */}
      {net.searchingRanked && <RankedSearch onCancel={actions.handleCancelQueue} />}

      {net.incomingInvite && (
        <div className="friend-invite-toast animate-scale-up" role="status">
          <span className="friend-invite-text">
            {t('invite.text', { name: net.incomingInvite.fromName })}
          </span>
          <div className="friend-invite-actions">
            <button className="btn-premium btn-primary" onClick={actions.handleAcceptInvite}>
              {t('invite.accept')}
            </button>
            <button className="btn-premium btn-secondary" onClick={() => net.setIncomingInvite(null)}>
              {t('invite.dismiss')}
            </button>
          </div>
        </div>
      )}

      {net.friendNotice && (
        <div className="friend-invite-toast animate-scale-up" role="status">
          <span className="friend-invite-text">{net.friendNotice}</span>
        </div>
      )}

      {modalesSociales}
      {vista !== 'partida' && modalesDeCatalogo}

      {net.showTournamentEntry && (
        <TournamentEntry
          onCreate={actions.handleCreateTournament}
          onJoin={actions.handleJoinTournament}
          onClose={() => net.setShowTournamentEntry(false)}
        />
      )}
    </VoiceProvider>
  );
}
