import React, { useState, useEffect, useRef } from 'react';
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
import VideoGrid from './components/VideoGrid';
import PlayerSeats from './components/PlayerSeats';
import useIsMobile from './hooks/useIsMobile';
import { Wifi, AlertCircle } from 'lucide-react';

export default function App() {
  const isMobile = useIsMobile();
  const [name, setName] = useState(localStorage.getItem('domino_username') || '');
  const [playerId, setPlayerId] = useState(sessionStorage.getItem('domino_player_id') || '');
  const [roomId, setRoomId] = useState(sessionStorage.getItem('domino_room_id') || '');
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState('');
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [selectedTileIndex, setSelectedTileIndex] = useState(null);
  const [quickNotifications, setQuickNotifications] = useState([]);
  const [publicRooms, setPublicRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [lobbyStats, setLobbyStats] = useState(null);
  const [showTurnBanner, setShowTurnBanner] = useState(false);
  
  // Estados para cartas de poderes
  const [selectedPower, setSelectedPower] = useState(null);
  const [pendingTargetType, setPendingTargetType] = useState(null);
  const [smuggleTileIdx, setSmuggleTileIdx] = useState(null);
   
  const prevGameStatusRef = useRef(null);
  const prevIsMyTurnRef = useRef(false);
 
   useEffect(() => {
     if (name) {
       localStorage.setItem('domino_username', name);
     }
   }, [name]);

  useEffect(() => {
    socket.connect();

    function onConnect() {
      setIsConnected(true);
      setError('');
      // Si el cliente se desconectó temporalmente y tiene datos guardados, re-unirse automáticamente
      const savedRoom = sessionStorage.getItem('domino_room_id');
      const savedPlayer = sessionStorage.getItem('domino_player_id');
      const savedName = localStorage.getItem('domino_username');
      if (savedRoom && savedPlayer && savedName) {
        socket.emit('join_room', { roomId: savedRoom, name: savedName, playerId: savedPlayer });
      }
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    function onRoomCreated({ roomId, playerId }) {
      setRoomId(roomId);
      setPlayerId(playerId);
      sessionStorage.setItem('domino_room_id', roomId);
      sessionStorage.setItem('domino_player_id', playerId);
      setError('');
    }

    function onRoomJoined({ roomId, playerId }) {
      setRoomId(roomId);
      setPlayerId(playerId);
      sessionStorage.setItem('domino_room_id', roomId);
      sessionStorage.setItem('domino_player_id', playerId);
      setError('');
    }

    function onGameState(state) {
      setGameState(state);

      // Reproducción reactiva de sonidos basados en transiciones de estado
      const prevStatus = prevGameStatusRef.current;
      const currentStatus = state.status;

      if (prevStatus && prevStatus !== currentStatus) {
        if (currentStatus === 'round_ended') {
          if (state.roundWinner === 'tie') {
            playGameSound('pass');
          } else {
            playGameSound('win_round');
          }
        } else if (currentStatus === 'game_ended') {
          playGameSound('win_game');
        }
      }
      prevGameStatusRef.current = currentStatus;
    }

    function onPlaySound({ type }) {
      playGameSound(type);
    }

    function onReceiveQuickMessage(msg) {
      const id = `${Date.now()}_${Math.random()}`;
      const newNotification = {
        id,
        playerName: msg.playerName,
        text: msg.text,
        type: msg.type,
        // Posicionamiento horizontal aleatorio para los emojis flotantes
        xOffset: Math.floor(Math.random() * 60) - 30 // -30px a +30px
      };
      
      setQuickNotifications(prev => [...prev, newNotification]);

      // Remover notificación después de que termine su animación
      setTimeout(() => {
        setQuickNotifications(prev => prev.filter(n => n.id !== id));
      }, msg.type === 'emoji' ? 2500 : 3500);
    }

    function onErrorMsg(message) {
      setError(message);
      // Ocultar error después de 5 segundos
      setTimeout(() => setError(''), 5000);
    }

    function onRoomsList(list) {
      setPublicRooms(Array.isArray(list) ? list : []);
      setRoomsLoading(false);
    }

    function onLobbyStats(stats) {
      setLobbyStats(stats);
    }

    // Nos expulsó el administrador: volvemos al lobby (el servidor ya nos sacó).
    function onKicked({ by }) {
      sessionStorage.removeItem('domino_room_id');
      sessionStorage.removeItem('domino_player_id');
      setRoomId('');
      setGameState(null);
      prevGameStatusRef.current = null;
      setError(`${by || 'El administrador'} te expulsó de la sala.`);
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
    socket.on('lobby_stats', onLobbyStats);
    socket.on('kicked', onKicked);

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
      socket.off('lobby_stats', onLobbyStats);
      socket.off('kicked', onKicked);
    };
  }, []);

  // Suscripción a la lista de salas: solo mientras se está en el lobby.
  const inLobby = !gameState || !roomId;
  useEffect(() => {
    if (!isConnected || !inLobby) return undefined;
    setRoomsLoading(true);
    socket.emit('lobby_subscribe');
    return () => socket.emit('lobby_unsubscribe');
  }, [isConnected, inLobby]);

  const handleCreateRoom = (options = {}) => {
    const {
      powersEnabled = true,
      maxPip = 6,
      teamsEnabled = false,
      drawEnabled = true,
      maxScore = null,
      isPublic = true
    } = options;
    socket.emit('create_room', {
      name, powersEnabled, maxPip, teamsEnabled, drawEnabled, maxScore, isPublic
    });
  };

  const handleQuickPlay = () => {
    socket.emit('quick_play', { name, playerId });
  };

  const handleJoinRoom = (code) => {
    socket.emit('join_room', { roomId: code, name });
  };

  const handleLeaveRoom = () => {
    // Salida explícita: el servidor libera la silla en vez de reservarla
    // esperando una reconexión que no va a llegar. No hace falta tirar el
    // socket: sigue vivo y listo para crear o unirse a otra sala.
    socket.emit('leave_room');

    sessionStorage.removeItem('domino_room_id');
    sessionStorage.removeItem('domino_player_id');

    setRoomId('');
    setPlayerId('');
    setGameState(null);
    setSelectedTileIndex(null);
    setSelectedPower(null);
    setPendingTargetType(null);
    prevGameStatusRef.current = null;
    setError('');
  };

  const me = gameState ? gameState.players.find(p => p.id === playerId) : null;
  const isMyTurn = gameState ? (gameState.currentPlayerId === playerId && gameState.status === 'playing') : false;
  const leftEnd = gameState && gameState.board.length > 0 ? gameState.board[0][0] : null;
  const rightEnd = gameState && gameState.board.length > 0 ? gameState.board[gameState.board.length - 1][1] : null;

  // Disparar banner animado cuando es el turno del jugador local
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnRef.current) {
      setShowTurnBanner(true);
      const timer = setTimeout(() => {
        setShowTurnBanner(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [isMyTurn]);

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

  // Handlers para Cartas de Poderes
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
    // Limpiar estados
    setSelectedPower(null);
    setPendingTargetType(null);
    setSmuggleTileIdx(null);
  };

  const handleEndTargetSelected = (side) => {
    if (!selectedPower) return;
    handleUsePower(selectedPower.id, side, null);
    setSelectedPower(null);
    setPendingTargetType(null);
  };

  const handleTileClickOverride = (tileIndex, tile) => {
    if (pendingTargetType === 'hand_tile_target') {
      handleUsePower(selectedPower.id, null, tileIndex);
      setSelectedPower(null);
      setPendingTargetType(null);
    } else if (pendingTargetType === 'smuggle_select_tile') {
      setSmuggleTileIdx(tileIndex);
      setPendingTargetType('smuggle_select_player');
    }
  };

  // Renderizado del contenido principal
  if (!gameState || !roomId) {
    return (
      <Lobby
        name={name}
        setName={setName}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        onQuickPlay={handleQuickPlay}
        publicRooms={publicRooms}
        roomsLoading={roomsLoading}
        stats={lobbyStats}
      />
    );
  }

  // UN SOLO provider de voz envolviendo sala de espera Y tablero. Si hubiera uno
  // por pantalla, React desmontaría el hook al empezar la partida y la llamada
  // se cortaría justo en ese momento.
  return (
    <VoiceProvider roomId={roomId} playerId={playerId}>
      {gameState.status === 'waiting' ? (
        <WaitingRoom
          gameState={gameState}
          playerId={playerId}
          onLeave={handleLeaveRoom}
        />
      ) : (
    <div className="app-container">
      
      {/* Banner flotante de Tu Turno */}
      {showTurnBanner && (
        <div className="turn-splash-overlay">
          <h2 className="turn-splash-text">¡TU TURNO!</h2>
        </div>
      )}

      {/* Indicador de Desconexión de Red */}
      {!isConnected && (
        <div className="network-alert">
          <Wifi size={12} />
          Conexión perdida. Reconectando…
        </div>
      )}

      {/* Banner de error temporal */}
      {error && (
        <div className="error-toast">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {/* Emojis flotantes y frases rápidas en pantalla */}
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
            // Una sola línea: nombre discreto + mensaje. Antes iba en dos
            // líneas, en negrita y a 1rem, y tapaba media mesa.
            <div key={notif.id} className="floating-toast">
              <span className="floating-toast-sender">{notif.playerName}</span>
              <span className="floating-toast-text">{notif.text}</span>
            </div>
          );
        }
      })}

      {/* Una sola barra, en móvil y escritorio. La lateral de 320px repetía lo
          que ya dicen los asientos alrededor del tablero. */}
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
      />

      {/* Área de Juego Principal */}
      <div className="game-area">
        {/* Tablero + chat: el botón flotante se ancla aquí para no tapar la mano */}
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
            seatsPadding={isMobile ? 170 : 240}
          />

          {/* Chat rápido de Emojis y Frases */}
          <Chat roomId={roomId} playerId={playerId} />

          {/* Miniaturas de cámara flotando sobre el tablero: aquí no le quitan
              altura, cosa que en móvil dejaba el tablero sin espacio.
              En móvil solo se muestra la tuya: los rivales salen en su asiento. */}
          {/* Tu propia cámara: los rivales salen en su asiento, no aquí. */}
          <VideoGrid players={gameState.players} playerId={playerId} selfOnly />

          {/* Los rivales alrededor de la mesa, en su sitio según el turno */}
          <PlayerSeats
            players={gameState.players}
            playerId={playerId}
            currentPlayerId={gameState.currentPlayerId}
            teamsEnabled={gameState.teamsEnabled}
            powersEnabled={gameState.powersEnabled}
            pendingTargetType={pendingTargetType}
            onSelectPlayerTarget={handlePlayerTargetSelected}
          />
        </div>

        {/* Cartas de Poderes del Jugador (ocultas en modo clásico) */}
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

        {/* Mano del Jugador Local */}
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

      {/* Modal de Finalización de Ronda / Partida */}
      <EndGameModal gameState={gameState} playerId={playerId} />
    </div>
      )}
    </VoiceProvider>
  );
}
