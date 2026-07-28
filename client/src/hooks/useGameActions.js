import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { useHubStore } from '../hub/stores/useHubStore';
import { useGameStore, getOrCreatePersistentPlayerId } from '../store/useGameStore';

/**
 * Todo lo que el jugador EMITE hacia el servidor, en un solo sitio.
 *
 * Contrapartida de `useGameSocket` (que sólo escucha). Antes ambos vivían
 * mezclados en App.jsx junto al JSX; separarlos hace que se pueda leer «qué
 * puede hacer el jugador» sin atravesar 900 líneas de vistas.
 *
 * NO se suscribe al store: cada handler lee el estado fresco con `getState()` en
 * el momento de ejecutarse. Dos ventajas sobre destructurar `useGameStore()`:
 * este hook no aporta ni un re-render, y ningún handler puede quedarse con un
 * valor viejo capturado en el render en que se creó.
 *
 * Recibe por parámetro únicamente lo que no puede sacar por su cuenta: el estado
 * que posee `useGameSocket` y su reseteador de transición de partida.
 */
export default function useGameActions({
  tournament,
  setTournament,
  setShowTournamentEntry,
  setSearchingRanked,
  incomingInvite,
  setIncomingInvite,
  resetGameStatus
}) {
  const { t } = useT();

  const flashError = (msg) => {
    const { setError } = useGameStore.getState();
    setError(msg);
    setTimeout(() => setError(''), 4000);
  };

  const requireName = () => {
    const { name } = useGameStore.getState();
    if (!name || !name.trim()) {
      flashError(t('lobby.nameRequired'));
      return false;
    }
    return true;
  };

  // ─── Salas ───
  const handleCreateRoom = (options = {}) => {
    const { name } = useGameStore.getState();
    const { selectedGameId } = useHubStore.getState();
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
      gameType: selectedGameId || 'domino',
      name, powersEnabled, maxPip, teamsEnabled, drawEnabled, maxScore, isPublic,
      powerIntensity, onePowerPerTurn,
      playerId: getOrCreatePersistentPlayerId()
    });
  };

  const handleQuickPlay = () => {
    const { name } = useGameStore.getState();
    const { selectedGameId } = useHubStore.getState();
    socket.emit('quick_play', {
      gameType: selectedGameId || 'domino',
      name,
      playerId: getOrCreatePersistentPlayerId()
    });
  };

  const handleJoinRoom = (code) => {
    const { name } = useGameStore.getState();
    socket.emit('join_room', { roomId: code, name, playerId: getOrCreatePersistentPlayerId() });
  };

  const handleLeaveRoom = () => {
    const s = useGameStore.getState();
    socket.emit('leave_room');
    sessionStorage.removeItem('domino_room_id');
    sessionStorage.removeItem('domino_player_id');

    s.setRoomId('');
    s.setPlayerId('');
    s.setGameState(null);
    s.setSelectedTileIndex(null);
    s.resetPowerState();
    resetGameStatus();
    s.setError('');
  };

  // ─── Torneo (1–4 humanos + bots) ───
  const handleOpenTournament = () => {
    if (requireName()) setShowTournamentEntry(true);
  };
  const handleCreateTournament = () => {
    if (!requireName()) return;
    const { name } = useGameStore.getState();
    socket.emit('create_tournament', { playerId: getOrCreatePersistentPlayerId(), name: name.trim() });
  };
  const handleJoinTournament = (code) => {
    if (!requireName()) return;
    const { name } = useGameStore.getState();
    socket.emit('join_tournament', { playerId: getOrCreatePersistentPlayerId(), name: name.trim(), code });
  };
  const handleStartTournament = () => {
    if (tournament?.id) socket.emit('start_tournament', { tournamentId: tournament.id });
  };
  const handlePlayTournamentMatch = () => {
    if (!tournament?.yourMatchRoomId) return;
    const { name } = useGameStore.getState();
    socket.emit('join_room', {
      roomId: tournament.yourMatchRoomId,
      name,
      playerId: getOrCreatePersistentPlayerId()
    });
  };
  const handleExitTournament = () => {
    const s = useGameStore.getState();
    socket.emit('leave_tournament', { playerId: getOrCreatePersistentPlayerId() });
    setTournament(null);
    sessionStorage.removeItem('domino_room_id');
    s.setRoomId('');
    s.setGameState(null);
  };

  // ─── Emparejamiento clasificatorio (cola por ELO) ───
  const handleFindRanked = () => {
    if (!requireName()) return;
    const { name } = useGameStore.getState();
    socket.emit('join_queue', { playerId: getOrCreatePersistentPlayerId(), name: name.trim() });
    setSearchingRanked(true);
  };
  const handleCancelQueue = () => {
    socket.emit('leave_queue');
    setSearchingRanked(false);
  };

  // ─── Amigos ───
  const handleAcceptInvite = () => {
    if (!incomingInvite) return;
    const { name } = useGameStore.getState();
    socket.emit('join_room', {
      roomId: incomingInvite.roomId,
      name,
      playerId: getOrCreatePersistentPlayerId()
    });
    setIncomingInvite(null);
  };

  // ─── Espectador ───
  const handleSpectate = (code) => {
    socket.emit('spectate_room', { roomId: code });
  };

  const handleLeaveSpectate = () => {
    const s = useGameStore.getState();
    socket.emit('leave_spectate', { roomId: s.spectating });
    s.setSpectating(null);
    s.setGameState(null);
    resetGameStatus();
    s.setError('');
  };

  // ─── Jugadas ───
  const handlePlayTile = (tileIndex, side) => {
    const { roomId, playerId, setSelectedTileIndex } = useGameStore.getState();
    if (!roomId) return;
    socket.emit('play_tile', { roomId, playerId, tileIndex, side });
    setSelectedTileIndex(null);
  };

  const handleDrawTile = () => {
    const { roomId, playerId } = useGameStore.getState();
    if (!roomId) return;
    socket.emit('draw_tile', { roomId, playerId });
  };

  const handlePassTurn = () => {
    const { roomId, playerId } = useGameStore.getState();
    if (!roomId) return;
    socket.emit('pass_turn', { roomId, playerId });
  };

  // ─── Cartas de poder ───
  const handleUsePower = (cardId, targetId, tileIndex) => {
    const { roomId, playerId } = useGameStore.getState();
    if (!roomId) return;
    socket.emit('use_power_card', { roomId, playerId, cardId, targetId, tileIndex });
  };

  const handlePlayerTargetSelected = (targetPlayerId) => {
    const { selectedPower, smuggleTileIdx, resetPowerState } = useGameStore.getState();
    if (!selectedPower) return;
    handleUsePower(
      selectedPower.id,
      targetPlayerId,
      selectedPower.id === 'smuggle' ? smuggleTileIdx : null
    );
    resetPowerState();
  };

  const handleEndTargetSelected = (side) => {
    const { selectedPower, resetPowerState } = useGameStore.getState();
    if (!selectedPower) return;
    handleUsePower(selectedPower.id, side, null);
    resetPowerState();
  };

  const handleTileClickOverride = (tileIndex) => {
    const {
      selectedPower, pendingTargetType,
      setSmuggleTileIdx, setPendingTargetType, resetPowerState
    } = useGameStore.getState();

    if (pendingTargetType === 'hand_tile_target') {
      handleUsePower(selectedPower.id, null, tileIndex);
      resetPowerState();
    } else if (pendingTargetType === 'smuggle_select_tile') {
      setSmuggleTileIdx(tileIndex);
      setPendingTargetType('smuggle_select_player');
    }
  };

  return {
    handleCreateRoom,
    handleQuickPlay,
    handleJoinRoom,
    handleLeaveRoom,
    handleOpenTournament,
    handleCreateTournament,
    handleJoinTournament,
    handleStartTournament,
    handlePlayTournamentMatch,
    handleExitTournament,
    handleFindRanked,
    handleCancelQueue,
    handleAcceptInvite,
    handleSpectate,
    handleLeaveSpectate,
    handlePlayTile,
    handleDrawTile,
    handlePassTurn,
    handleUsePower,
    handlePlayerTargetSelected,
    handleEndTargetSelected,
    handleTileClickOverride
  };
}
