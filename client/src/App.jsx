import React, { useEffect, useRef } from 'react';
import { socket } from './socket';
import { playGameSound } from './audio';
import Lobby from './components/Lobby';
import WaitingRoom from './components/WaitingRoom';
import GameBoard from './components/GameBoard';
import PlayerHand from './components/PlayerHand';
import GameBar from './components/GameBar';
import Chat from './components/Chat';
import EndGameModal from './components/EndGameModal';
import PowerCards from './components/PowerCards';
import { VoiceProvider } from './voice/VoiceContext';
import { useT } from './i18n/LanguageContext';
import VideoGrid from './components/VideoGrid';
import PlayerSeats from './components/PlayerSeats';
import useIsMobile from './hooks/useIsMobile';
import { Wifi, AlertCircle } from 'lucide-react';
import ProfileModal from './components/ProfileModal';
import SpectatorView from './components/SpectatorView';

import SpyReveal from './components/SpyReveal';
import EpicMoment from './components/EpicMoment';
import LegendaryEffect from './components/LegendaryEffect';
import TournamentBracket from './components/TournamentBracket';
import TournamentHub from './components/TournamentHub';
import TournamentEntry from './components/TournamentEntry';
import RankedSearch from './components/RankedSearch';
import FriendsModal from './components/FriendsModal';
import LeaderboardModal from './components/LeaderboardModal';
import SkinStoreModal from './components/SkinStoreModal';
import { recordGame, recordRoundWin } from './stats';
import { initTheme, applySkin, applyTable } from './theme';
import { useGameStore, getOrCreatePersistentPlayerId } from './store/useGameStore';

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

export default function App() {
  const { t } = useT();
  const isMobile = useIsMobile();

  const {
    name, setName,
    playerId, setPlayerId,
    roomId, setRoomId,
    gameState, setGameState,
    error, setError,
    isConnected, setIsConnected,
    selectedTileIndex, setSelectedTileIndex,
    quickNotifications, setQuickNotifications,
    publicRooms, setPublicRooms,
    roomsLoading, setRoomsLoading,
    lobbyStats, setLobbyStats,
    showTurnBanner, setShowTurnBanner,
    selectedPower, setSelectedPower,
    pendingTargetType, setPendingTargetType,
    smuggleTileIdx, setSmuggleTileIdx,
    showProfile, setShowProfile,
    spectating, setSpectating,
    liveGames, setLiveGames,
    epicMoment, setEpicMoment,
    invitedCode, setInvitedCode,
    resetPowerState
  } = useGameStore();

  const [legendaryEffect, setLegendaryEffect] = React.useState(null);
  const [showBracket, setShowBracket] = React.useState(false);
  const [showLeaderboard, setShowLeaderboard] = React.useState(false);
  const [showStore, setShowStore] = React.useState(false);
  const [showFriends, setShowFriends] = React.useState(false);
  const [incomingInvite, setIncomingInvite] = React.useState(null);
  const [friendNotice, setFriendNotice] = React.useState('');
  const [tournament, setTournament] = React.useState(null);
  const [showTournamentEntry, setShowTournamentEntry] = React.useState(false);
  const [searchingRanked, setSearchingRanked] = React.useState(false);
  const tournamentRef = useRef(null);
  tournamentRef.current = tournament;

  const tMsg = (key, params) => {
    if (!params) return t(key);
    const p = { ...params };
    for (const k in p) if (p[k] === '@opponent') p[k] = t('srv.opponent');
    return t(key, p);
  };

  const renderError = (e) =>
    typeof e === 'string' ? e : (e && e.key ? tMsg(e.key, e.params) : '');

  const prevGameStatusRef = useRef(null);
  const prevIsMyTurnRef = useRef(false);

  useEffect(() => {
    const code = readInviteCode();
    if (code) setInvitedCode(code);
  }, [setInvitedCode]);

  const invitedCodeRef = useRef(invitedCode);
  invitedCodeRef.current = invitedCode;
  const autoJoinedRef = useRef(false);

  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;
  const tRef = useRef(t);
  tRef.current = t;

  const spectatingRef = useRef(spectating);
  spectatingRef.current = spectating;

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  useEffect(() => {
    if (name) {
      localStorage.setItem('domino_username', name);
    }
  }, [name]);

  useEffect(() => { initTheme(); }, []);

  useEffect(() => {
    if (!epicMoment) return undefined;
    playGameSound('epic');
    const dur = 4000;
    const id = setTimeout(() => setEpicMoment(null), dur);
    return () => clearTimeout(id);
  }, [epicMoment, setEpicMoment]);

  useEffect(() => {
    if (window.location.pathname !== '/' || window.location.search) {
      try { window.history.replaceState({}, '', '/'); } catch { /* noop */ }
    }
  }, []);

  useEffect(() => {
    if (!isConnected || !invitedCode || roomId || autoJoinedRef.current) return;
    if (name && name.trim()) {
      autoJoinedRef.current = true;
      socket.emit('join_room', { roomId: invitedCode, name: name.trim(), playerId: getOrCreatePersistentPlayerId() });
    }
  }, [isConnected, invitedCode, roomId, name]);

  useEffect(() => {
    socket.connect();

    function onConnect() {
      setIsConnected(true);
      setError('');

      // Sincronizar skins del perfil guardado en BD
      const persistId = getOrCreatePersistentPlayerId();
      const savedName = localStorage.getItem('domino_username');
      socket.emit('get_profile', { playerId: persistId, username: savedName || 'Jugador' });

      if (invitedCodeRef.current) return;
      const savedRoom = sessionStorage.getItem('domino_room_id');
      const savedPlayer = sessionStorage.getItem('domino_player_id');
      if (savedRoom && savedPlayer && savedName) {
        socket.emit('join_room', { roomId: savedRoom, name: savedName, playerId: savedPlayer });
      }
    }

    function onProfileBoot(data) {
      if (!data) return;
      // Aplicar skins guardadas en la BD al CSS del cliente
      if (data.equipped_tile_skin) applySkin(data.equipped_tile_skin);
      if (data.equipped_board_theme) applyTable(data.equipped_board_theme);

      // Recompensa por racha de login (solo el primer login del día).
      if (data.daily && data.daily.loginReward) {
        const nid = `login_${Date.now()}`;
        setQuickNotifications(prev => [...prev, {
          id: nid,
          playerName: '',
          text: tRef.current('mission.loginReward', { n: data.daily.streak || 1, reward: data.daily.loginReward }),
          type: 'phrase',
          xOffset: 0
        }]);
        setTimeout(() => setQuickNotifications(prev => prev.filter(n => n.id !== nid)), 5000);
      }
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    function onRoomCreated({ roomId: newRoomId, playerId: newPlayerId }) {
      setRoomId(newRoomId);
      setPlayerId(newPlayerId);
      sessionStorage.setItem('domino_room_id', newRoomId);
      sessionStorage.setItem('domino_player_id', newPlayerId);
      setError('');
    }

    function onRoomJoined({ roomId: newRoomId, playerId: newPlayerId }) {
      setRoomId(newRoomId);
      setPlayerId(newPlayerId);
      sessionStorage.setItem('domino_room_id', newRoomId);
      sessionStorage.setItem('domino_player_id', newPlayerId);
      setError('');
      setInvitedCode('');
    }

    function onGameState(state) {
      setGameState(state);

      const prevStatus = prevGameStatusRef.current;
      const currentStatus = state.status;

      if (prevStatus && prevStatus !== currentStatus) {
        if (currentStatus === 'round_ended') {
          if (state.roundWinner === 'tie') {
            playGameSound('pass');
          } else {
            playGameSound('win_round');
          }
          if (!state.isSpectator) recordRoundWin(state, playerIdRef.current);

          if (!state.isSpectator && state.roundWinner !== 'tie') {
            const winP = state.players.find(p => p.id === state.roundWinner);
            const sub = state.teamsEnabled
              ? tRef.current(state.roundWinnerTeam === 0 ? 'team.a' : 'team.b')
              : (winP ? winP.name : '');
            const tranca = !!(state.lastPlay && state.lastPlay.side === 'pass');
            setEpicMoment({
              id: `${Date.now()}_${Math.random()}`,
              kind: tranca ? 'tranca' : 'domino',
              title: tRef.current(tranca ? 'epic.tranca' : 'epic.domino'),
              sub,
              starId: state.roundWinner
            });
          }
        } else if (currentStatus === 'game_ended') {
          playGameSound('win_game');
          const unlocked = state.isSpectator ? [] : recordGame(state, playerIdRef.current);
          for (const id of unlocked) {
            const nid = `ach_${id}_${Date.now()}`;
            setQuickNotifications(prev => [...prev, {
              id: nid,
              playerName: '',
              text: tRef.current('profile.unlocked', { name: tRef.current(`ach.${id}.n`) }),
              type: 'phrase',
              xOffset: 0
            }]);
            setTimeout(() => {
              setQuickNotifications(prev => prev.filter(n => n.id !== nid));
            }, 4000);
          }

          if (!state.isSpectator) {
            const maxScore = state.maxScore || 100;
            const winP = state.players.find(p => p.id === state.gameWinner);
            const sub = state.teamsEnabled
              ? tRef.current(state.gameWinnerTeam === 0 ? 'team.a' : 'team.b')
              : (winP ? winP.name : '');
            let rivalPeak = 0;
            if (state.teamsEnabled) {
              const loseTeam = state.gameWinnerTeam === 0 ? 1 : 0;
              rivalPeak = (state.teamScores || [0, 0])[loseTeam] || 0;
            } else {
              rivalPeak = state.players
                .filter(p => p.id !== state.gameWinner)
                .reduce((m, p) => Math.max(m, p.score || 0), 0);
            }
            const comeback = rivalPeak >= maxScore * 0.7;
            setEpicMoment({
              id: `${Date.now()}_${Math.random()}`,
              kind: comeback ? 'comeback' : 'victory',
              title: tRef.current(comeback ? 'epic.comeback' : 'epic.victory'),
              sub,
              starId: state.gameWinner
            });
          }
        }
      }
      prevGameStatusRef.current = currentStatus;
    }

    function onPlaySound({ type }) {
      playGameSound(type);
    }

    function onReceiveQuickMessage(msg) {
      const LEGENDARY = { 'srv.pw.mind_swap': 1, 'srv.pw.russian_roulette': 1, 'srv.pw.block_both': 1 };
      if (msg.key && LEGENDARY[msg.key] && !spectatingRef.current) {
        const casterName = msg.params && msg.params.name;
        const gs = gameStateRef.current;
        const caster = casterName && gs ? gs.players.find(p => p.name === casterName) : null;
        const powerId = msg.key.slice('srv.pw.'.length);
        setLegendaryEffect({
          id: powerId,
          casterName: casterName || '',
          title: tRef.current(`pw.${powerId}.n`)
        });
        setEpicMoment({
          id: `${Date.now()}_${Math.random()}`,
          kind: 'power',
          title: tRef.current(`pw.${powerId}.n`),
          sub: casterName || '',
          starId: caster ? caster.id : null
        });
      }

      const id = `${Date.now()}_${Math.random()}`;
      const newNotification = {
        id,
        playerName: msg.playerName,
        text: msg.text,
        msgKey: msg.key,
        params: msg.params,
        type: msg.type,
        xOffset: Math.floor(Math.random() * 60) - 30
      };
      
      setQuickNotifications(prev => [...prev, newNotification]);

      setTimeout(() => {
        setQuickNotifications(prev => prev.filter(n => n.id !== id));
      }, msg.type === 'emoji' ? 2500 : 3500);
    }

    function onErrorMsg(payload) {
      setError(payload);
      setTimeout(() => setError(''), 5000);
    }

    function onRoomsList(list) {
      setPublicRooms(Array.isArray(list) ? list : []);
      setRoomsLoading(false);
    }

    function onLiveGames(list) {
      setLiveGames(Array.isArray(list) ? list : []);
    }

    function onSpectating({ roomId: specRoomId }) {
      setSpectating(specRoomId);
      setError('');
    }

    function onRoomClosed() {
      if (spectatingRef.current) {
        setSpectating(null);
        setGameState(null);
        prevGameStatusRef.current = null;
        setError(tRef.current('spec.closed'));
        setTimeout(() => setError(''), 4000);
        return;
      }
      // En un torneo, cerrar la sala de la partida devuelve al cuadro (no al lobby).
      if (tournamentRef.current) {
        sessionStorage.removeItem('domino_room_id');
        setRoomId('');
        setGameState(null);
        prevGameStatusRef.current = null;
      }
    }

    function onTournamentState(state) {
      setTournament(state);
      setShowTournamentEntry(false);
    }

    function onTournamentError(payload) {
      setError(payload && payload.key ? { key: payload.key } : payload);
      setTimeout(() => setError(''), 4000);
    }

    function onMatchFound({ roomId: mmRoomId, playerId: mmPlayerId }) {
      setSearchingRanked(false);
      socket.emit('join_room', { roomId: mmRoomId, playerId: mmPlayerId });
    }

    function onFriendInvited({ fromName, roomId: invRoom }) {
      if (invRoom) setIncomingInvite({ fromName: fromName || '—', roomId: invRoom });
    }

    function onFriendIncoming(data) {
      setFriendNotice(tRef.current(data && data.accepted ? 'friend.accepted' : 'friend.incoming'));
      setTimeout(() => setFriendNotice(''), 4000);
    }

    function onLobbyStats(stats) {
      setLobbyStats(stats);
    }

    function onKicked({ by }) {
      sessionStorage.removeItem('domino_room_id');
      sessionStorage.removeItem('domino_player_id');
      setRoomId('');
      setGameState(null);
      prevGameStatusRef.current = null;
      setError(t('end.kicked', { name: by || '—' }));
      setTimeout(() => setError(''), 6000);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_created', onRoomCreated);
    socket.on('room_joined', onRoomJoined);
    socket.on('game_state', onGameState);
    socket.on('play_sound', onPlaySound);
    socket.on('receive_quick_message', onReceiveQuickMessage);
    socket.on('error_msg', onErrorMsg);
    socket.on('rooms_list', onRoomsList);
    socket.on('live_games', onLiveGames);
    socket.on('lobby_stats', onLobbyStats);
    socket.on('kicked', onKicked);
    socket.on('spectating', onSpectating);
    socket.on('room_closed', onRoomClosed);
    socket.on('profile_data', onProfileBoot);
    socket.on('tournament_state', onTournamentState);
    socket.on('tournament_error', onTournamentError);
    socket.on('match_found', onMatchFound);
    socket.on('friend_invited', onFriendInvited);
    socket.on('friend_incoming', onFriendIncoming);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_created', onRoomCreated);
      socket.off('room_joined', onRoomJoined);
      socket.off('game_state', onGameState);
      socket.off('play_sound', onPlaySound);
      socket.off('receive_quick_message', onReceiveQuickMessage);
      socket.off('error_msg', onErrorMsg);
      socket.off('rooms_list', onRoomsList);
      socket.off('live_games', onLiveGames);
      socket.off('lobby_stats', onLobbyStats);
      socket.off('kicked', onKicked);
      socket.off('spectating', onSpectating);
      socket.off('room_closed', onRoomClosed);
      socket.off('profile_data', onProfileBoot);
      socket.off('tournament_state', onTournamentState);
      socket.off('tournament_error', onTournamentError);
      socket.off('match_found', onMatchFound);
      socket.off('friend_invited', onFriendInvited);
      socket.off('friend_incoming', onFriendIncoming);
    };
  }, [
    setError, setIsConnected, setInvitedCode, setPlayerId, setRoomId, setGameState,
    setEpicMoment, setQuickNotifications, setPublicRooms, setRoomsLoading,
    setLiveGames, setSpectating, setLobbyStats, t
  ]);

  const inLobby = !spectating && (!gameState || !roomId);
  useEffect(() => {
    if (!isConnected || !inLobby) return undefined;
    setRoomsLoading(true);
    socket.emit('lobby_subscribe');
    return () => socket.emit('lobby_unsubscribe');
  }, [isConnected, inLobby, setRoomsLoading]);

  const handleCreateRoom = (options = {}) => {
    const {
      powersEnabled = true,
      maxPip = 6,
      teamsEnabled = false,
      drawEnabled = true,
      maxScore = null,
      isPublic = true,
      powerIntensity = 'normal',
      onePowerPerTurn = false
    } = options;
    socket.emit('create_room', {
      name, powersEnabled, maxPip, teamsEnabled, drawEnabled, maxScore, isPublic,
      powerIntensity, onePowerPerTurn,
      playerId: getOrCreatePersistentPlayerId()
    });
  };

  const handleQuickPlay = () => {
    socket.emit('quick_play', { name, playerId: getOrCreatePersistentPlayerId() });
  };

  const handleJoinRoom = (code) => {
    socket.emit('join_room', { roomId: code, name, playerId: getOrCreatePersistentPlayerId() });
  };

  // ─── Torneo (1–4 humanos + bots) ───
  const requireNameForTourney = () => {
    if (!name || !name.trim()) {
      setError(t('lobby.nameRequired'));
      setTimeout(() => setError(''), 4000);
      return false;
    }
    return true;
  };
  const handleOpenTournament = () => {
    if (requireNameForTourney()) setShowTournamentEntry(true);
  };
  const handleCreateTournament = () => {
    if (!requireNameForTourney()) return;
    socket.emit('create_tournament', { playerId: getOrCreatePersistentPlayerId(), name: name.trim() });
  };
  const handleJoinTournament = (code) => {
    if (!requireNameForTourney()) return;
    socket.emit('join_tournament', { playerId: getOrCreatePersistentPlayerId(), name: name.trim(), code });
  };
  const handleStartTournament = () => {
    if (tournament?.id) socket.emit('start_tournament', { tournamentId: tournament.id });
  };
  const handlePlayTournamentMatch = () => {
    if (tournament?.yourMatchRoomId) {
      socket.emit('join_room', { roomId: tournament.yourMatchRoomId, name, playerId: getOrCreatePersistentPlayerId() });
    }
  };
  const handleExitTournament = () => {
    socket.emit('leave_tournament', { playerId: getOrCreatePersistentPlayerId() });
    setTournament(null);
    sessionStorage.removeItem('domino_room_id');
    setRoomId('');
    setGameState(null);
  };

  // ─── Emparejamiento clasificatorio (cola por ELO) ───
  const handleFindRanked = () => {
    if (!requireNameForTourney()) return;
    socket.emit('join_queue', { playerId: getOrCreatePersistentPlayerId(), name: name.trim() });
    setSearchingRanked(true);
  };
  const handleCancelQueue = () => {
    socket.emit('leave_queue');
    setSearchingRanked(false);
  };

  const handleAcceptInvite = () => {
    if (!incomingInvite) return;
    socket.emit('join_room', { roomId: incomingInvite.roomId, name, playerId: getOrCreatePersistentPlayerId() });
    setIncomingInvite(null);
  };

  const handleSpectate = (code) => {
    socket.emit('spectate_room', { roomId: code });
  };

  const handleLeaveSpectate = () => {
    socket.emit('leave_spectate', { roomId: spectating });
    setSpectating(null);
    setGameState(null);
    prevGameStatusRef.current = null;
    setError('');
  };

  const handleLeaveRoom = () => {
    socket.emit('leave_room');
    sessionStorage.removeItem('domino_room_id');
    sessionStorage.removeItem('domino_player_id');

    setRoomId('');
    setPlayerId('');
    setGameState(null);
    setSelectedTileIndex(null);
    resetPowerState();
    prevGameStatusRef.current = null;
    setError('');
  };

  const me = gameState ? gameState.players.find(p => p.id === playerId) : null;
  const isMyTurn = gameState ? (gameState.currentPlayerId === playerId && gameState.status === 'playing') : false;
  const leftEnd = gameState && gameState.board.length > 0 ? gameState.board[0][0] : null;
  const rightEnd = gameState && gameState.board.length > 0 ? gameState.board[gameState.board.length - 1][1] : null;

  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnRef.current) {
      setShowTurnBanner(true);
      playGameSound('turn_alert');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([120, 80, 120]); } catch (e) {}
      }
      const timer = setTimeout(() => {
        setShowTurnBanner(false);
      }, 1600);
      return () => clearTimeout(timer);
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [isMyTurn, setShowTurnBanner]);

  const selectedTile = me && selectedTileIndex !== null ? me.hand[selectedTileIndex] : null;
  
  const isLeftFrozen = gameState && gameState.activeEffects?.frozenEnd === 'left' && gameState.activeEffects?.frozenEndOwnerId !== playerId;
  const isRightFrozen = gameState && gameState.activeEffects?.frozenEnd === 'right' && gameState.activeEffects?.frozenEndOwnerId !== playerId;
  const isWildcardActive = gameState && gameState.activeEffects?.wildcardActive;

  const canPlayLeft = selectedTile && gameState && (isWildcardActive || gameState.board.length === 0 || selectedTile[0] === leftEnd || selectedTile[1] === leftEnd) && !isLeftFrozen;
  const canPlayRight = selectedTile && gameState && gameState.board.length > 0 && (isWildcardActive || selectedTile[0] === rightEnd || selectedTile[1] === rightEnd) && !isRightFrozen;

  const handlePlayTile = (tileIndex, side) => {
    if (!roomId) return;
    socket.emit('play_tile', { roomId, playerId, tileIndex, side });
    setSelectedTileIndex(null);
  };

  const handleDrawTile = () => {
    if (!roomId) return;
    socket.emit('draw_tile', { roomId, playerId });
  };

  const handlePassTurn = () => {
    if (!roomId) return;
    socket.emit('pass_turn', { roomId, playerId });
  };

  const handleUsePower = (cardId, targetId, tileIndex) => {
    if (!roomId) return;
    socket.emit('use_power_card', { roomId, playerId, cardId, targetId, tileIndex });
  };

  const handlePlayerTargetSelected = (targetPlayerId) => {
    if (!selectedPower) return;
    if (selectedPower.id === 'smuggle') {
      handleUsePower(selectedPower.id, targetPlayerId, smuggleTileIdx);
    } else {
      handleUsePower(selectedPower.id, targetPlayerId, null);
    }
    resetPowerState();
  };

  const handleEndTargetSelected = (side) => {
    if (!selectedPower) return;
    handleUsePower(selectedPower.id, side, null);
    resetPowerState();
  };

  const handleTileClickOverride = (tileIndex, tile) => {
    if (pendingTargetType === 'hand_tile_target') {
      handleUsePower(selectedPower.id, null, tileIndex);
      resetPowerState();
    } else if (pendingTargetType === 'smuggle_select_tile') {
      setSmuggleTileIdx(tileIndex);
      setPendingTargetType('smuggle_select_player');
    }
  };

  if (spectating) {
    return gameState
      ? <SpectatorView gameState={gameState} onLeave={handleLeaveSpectate} />
      : (
        <div className="app-container spectator spec-loading">
          <span>{t('spec.badge')}…</span>
        </div>
      );
  }

  if (!gameState || !roomId) {
    // Modo torneo: mientras no estés dentro de una partida, se muestra el cuadro.
    if (tournament) {
      return (
        <TournamentHub
          tournament={tournament}
          onStart={handleStartTournament}
          onPlayMatch={handlePlayTournamentMatch}
          onExit={handleExitTournament}
        />
      );
    }
    return (
      <>
        <Lobby
          name={name}
          setName={setName}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuickPlay={handleQuickPlay}
          publicRooms={publicRooms}
          roomsLoading={roomsLoading}
          stats={lobbyStats}
          invitedCode={invitedCode}
          onOpenProfile={() => setShowProfile(true)}

          onOpenLeaderboard={() => setShowLeaderboard(true)}
          onOpenStore={() => setShowStore(true)}
          onOpenTournament={handleOpenTournament}
          onFindRanked={handleFindRanked}
          onOpenFriends={() => setShowFriends(true)}
          liveGames={liveGames}
          onSpectate={handleSpectate}
        />
        {searchingRanked && <RankedSearch onCancel={handleCancelQueue} />}
        {incomingInvite && (
          <div className="friend-invite-toast animate-scale-up">
            <span className="friend-invite-text">
              {tRef.current('invite.text', { name: incomingInvite.fromName })}
            </span>
            <div className="friend-invite-actions">
              <button className="btn-premium btn-primary" onClick={handleAcceptInvite}>{t('invite.accept')}</button>
              <button className="btn-premium btn-secondary" onClick={() => setIncomingInvite(null)}>{t('invite.dismiss')}</button>
            </div>
          </div>
        )}
        {friendNotice && (
          <div className="friend-invite-toast animate-scale-up">
            <span className="friend-invite-text">{friendNotice}</span>
          </div>
        )}
        {showFriends && <FriendsModal name={name} onClose={() => setShowFriends(false)} />}
        {showProfile && <ProfileModal name={name} onClose={() => setShowProfile(false)} />}

        {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}
        {showStore && <SkinStoreModal playerId={getOrCreatePersistentPlayerId()} name={name} onClose={() => setShowStore(false)} />}
        {showTournamentEntry && (
          <TournamentEntry
            onCreate={handleCreateTournament}
            onJoin={handleJoinTournament}
            onClose={() => setShowTournamentEntry(false)}
          />
        )}
      </>
    );
  }

  return (
    <VoiceProvider roomId={roomId} playerId={playerId}>
      {gameState.status === 'waiting' ? (
        <WaitingRoom
          gameState={gameState}
          playerId={playerId}
          onLeave={handleLeaveRoom}
        />
      ) : (
    <div className={`app-container ${isMyTurn ? 'my-turn-active' : ''}`}>
      {showTurnBanner && (
        <div className="turn-splash-overlay">
          <h2 className="turn-splash-text">{t('game.yourTurn')}</h2>
        </div>
      )}

      <SpyReveal gameState={gameState} playerId={playerId} />

      {legendaryEffect && <LegendaryEffect effect={legendaryEffect} onClose={() => setLegendaryEffect(null)} />}

      {epicMoment && <EpicMoment moment={epicMoment} gameState={gameState} playerId={playerId} />}

      {showBracket && <TournamentBracket gameState={gameState} onClose={() => setShowBracket(false)} />}

      {!isConnected && (
        <div className="network-alert">
          <Wifi size={12} />
          {t('net.lost')}
        </div>
      )}

      {error && (
        <div className="error-toast">
          <AlertCircle size={12} />
          {renderError(error)}
        </div>
      )}

      {quickNotifications.map((notif) => {
        if (notif.type === 'emoji') {
          return (
            <div 
              key={notif.id}
              className="floating-emoji"
              style={{
                left: '50%',
                bottom: '180px',
                transform: 'translateX(-50%)',
                marginLeft: `${notif.xOffset}px`
              }}
            >
              {notif.text}
            </div>
          );
        } else {
          return (
            <div key={notif.id} className="floating-toast">
              <span className="floating-toast-sender">
                {notif.playerName === 'SISTEMA' ? t('game.system') : notif.playerName}
              </span>
              <span className="floating-toast-text">
                {notif.msgKey ? tMsg(notif.msgKey, notif.params) : notif.text}
              </span>
            </div>
          );
        }
      })}

      <GameBar
        players={gameState.players}
        playerId={playerId}
        roundNumber={gameState.roundNumber}
        teamsEnabled={gameState.teamsEnabled}
        teamScores={gameState.teamScores || [0, 0]}
        maxScore={gameState.maxScore}
        onLeave={handleLeaveRoom}
        currentPlayerId={gameState.currentPlayerId}
        turnEndsAt={gameState.turnEndsAt}
        turnSecondsRemaining={gameState.turnSecondsRemaining}
        turnDurationSeconds={gameState.turnDurationSeconds}
        onOpenLeaderboard={() => setShowLeaderboard(true)}
        onOpenStore={() => setShowStore(true)}
      />

      {showLeaderboard && (
        <LeaderboardModal onClose={() => setShowLeaderboard(false)} />
      )}

      {showStore && (
        <SkinStoreModal playerId={getOrCreatePersistentPlayerId()} name={name} onClose={() => setShowStore(false)} />
      )}

      <div className="game-area">
        <div className="board-region">
          <GameBoard
            board={gameState.board}
            selectedTileIndex={selectedTileIndex}
            onPlay={handlePlayTile}
            isMyTurn={isMyTurn}
            players={gameState.players}
            currentPlayerId={gameState.currentPlayerId}
            canPlayLeft={canPlayLeft}
            canPlayRight={canPlayRight}
            pendingTargetType={pendingTargetType}
            onSelectEndTarget={handleEndTargetSelected}
            activeEffects={gameState.activeEffects}
            lastPlay={gameState.lastPlay}
            lastPlacedTile={gameState.lastPlacedTile}
            lastPlacedBy={gameState.lastPlacedBy}
            seatsPadding={isMobile ? 170 : 240}
            moveLog={gameState.moveLog || []}
            onOpenBracket={() => setShowBracket(true)}
            selectedPower={selectedPower}
          />

          <Chat roomId={roomId} playerId={playerId} />

          <VideoGrid players={gameState.players} playerId={playerId} selfOnly />

          <PlayerSeats
            players={gameState.players}
            playerId={playerId}
            currentPlayerId={gameState.currentPlayerId}
            teamsEnabled={gameState.teamsEnabled}
            powersEnabled={gameState.powersEnabled}
            pendingTargetType={pendingTargetType}
            onSelectPlayerTarget={handlePlayerTargetSelected}
            quickNotifications={quickNotifications}
            blitzTimeRemaining={gameState.blitzTimeRemaining}
          />
        </div>

        {me && gameState.status === 'playing' && gameState.powersEnabled !== false && (
          <PowerCards
            powers={me.powers}
            isMyTurn={isMyTurn}
            onUsePower={handleUsePower}
            selectedPower={selectedPower}
            setSelectedPower={setSelectedPower}
            pendingTargetType={pendingTargetType}
            setPendingTargetType={setPendingTargetType}
          />
        )}

        {me && (
          <PlayerHand
            hand={me.hand}
            isMyTurn={isMyTurn}
            selectedTileIndex={selectedTileIndex}
            setSelectedTileIndex={setSelectedTileIndex}
            leftEnd={leftEnd}
            rightEnd={rightEnd}
            onPlay={handlePlayTile}
            onDraw={handleDrawTile}
            onPass={handlePassTurn}
            boneyardCount={gameState.boneyardCount}
            boardIsEmpty={gameState.board.length === 0}
            wildcardActive={isWildcardActive}
            drawEnabled={gameState.drawEnabled !== false}
            onTileClickOverride={
              (pendingTargetType === 'hand_tile_target' || pendingTargetType === 'smuggle_select_tile')
                ? handleTileClickOverride
                : null
            }
          />
        )}
      </div>

      <EndGameModal
        key={`end-${gameState.status}-${gameState.roundNumber}`}
        gameState={gameState}
        playerId={playerId}
        tournamentMatch={!!tournament}
      />
    </div>
      )}
    </VoiceProvider>
  );
}
