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
import UnifiedVoiceWidget from './components/UnifiedVoiceWidget';
import GameView from './views/GameView';
import HubDashboard from './hub/HubDashboard';

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
 */
export default function App() {
  const { t } = useT();

  const {
    name, setName,
    playerId, roomId, gameState,
    error, isConnected,
    publicRooms, roomsLoading, lobbyStats,
    setShowTurnBanner, setRoomsLoading,
    showProfile, setShowProfile,
    spectating, liveGames, epicMoment, setEpicMoment, invitedCode, setInvitedCode
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

  // Modales compartidos por el hub y el lobby.
  const modales = (
    <>
      {showFriends && <FriendsModal name={name} onClose={() => setShowFriends(false)} />}
      {showProfile && <ProfileModal name={name} onClose={() => setShowProfile(false)} />}
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}
      {showStore && (
        <SkinStoreModal playerId={getOrCreatePersistentPlayerId()} name={name} onClose={() => setShowStore(false)} />
      )}
    </>
  );

  if (spectating) {
    return gameState
      ? <SpectatorView gameState={gameState} onLeave={actions.handleLeaveSpectate} />
      : (
        <div className="app-container spectator spec-loading">
          <span>{t('spec.badge')}…</span>
        </div>
      );
  }

  return (
    <VoiceProvider roomId={roomId} playerId={playerId} name={name}>
      <UnifiedVoiceWidget variant="floating" />

      {/* Avisos GLOBALES: antes vivían dentro de la rama de partida, así que una
          caída de conexión o un error del servidor (sala llena, código inválido)
          era invisible en el lobby y el hub. */}
      {!isConnected && (
        <div className="network-alert">
          <Wifi size={12} />
          {t('net.lost')}
        </div>
      )}

      {error && (
        <div className="error-toast">
          <AlertCircle size={12} />
          {renderError(t, error)}
        </div>
      )}

      {/* Router de vistas: torneo → hub → lobby → sala de espera → partida. */}
      {net.tournament ? (
        <TournamentHub
          tournament={net.tournament}
          onStart={actions.handleStartTournament}
          onPlayMatch={actions.handlePlayTournamentMatch}
          onExit={actions.handleExitTournament}
        />
      ) : !selectedGameId ? (
        <>
          <HubDashboard
            onOpenProfile={() => setShowProfile(true)}
            onOpenStore={() => setShowStore(true)}
            onOpenFriends={() => setShowFriends(true)}
            onOpenLeaderboard={() => setShowLeaderboard(true)}
          />
          {modales}
        </>
      ) : !roomId || !gameState ? (
        <>
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
          {net.searchingRanked && <RankedSearch onCancel={actions.handleCancelQueue} />}
          {net.incomingInvite && (
            <div className="friend-invite-toast animate-scale-up">
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
            <div className="friend-invite-toast animate-scale-up">
              <span className="friend-invite-text">{net.friendNotice}</span>
            </div>
          )}
          {modales}
          {net.showTournamentEntry && (
            <TournamentEntry
              onCreate={actions.handleCreateTournament}
              onJoin={actions.handleJoinTournament}
              onClose={() => net.setShowTournamentEntry(false)}
            />
          )}
        </>
      ) : gameState.status === 'waiting' ? (
        <WaitingRoom
          gameState={gameState}
          playerId={playerId}
          onLeave={actions.handleLeaveRoom}
        />
      ) : (
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
    </VoiceProvider>
  );
}
