import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { playGameSound } from '../audio';
import { recordGame, recordRoundWin } from '../stats';
import { applySkin, applyTable } from '../theme';
import { useT } from '../i18n/LanguageContext';
import { useGameStore, getOrCreatePersistentPlayerId } from '../store/useGameStore';

/**
 * Todos los listeners de socket entrantes, en un solo sitio.
 *
 * Antes vivían en un `useEffect` de ~350 líneas dentro de App.jsx, mezclados con
 * los emisores, la lógica de vistas y el JSX. Aquí dentro se queda además el
 * estado que SOLO tocan estos listeners (torneo, invitaciones, efecto legendario,
 * búsqueda de ranked), para que no haya que pasar una docena de setters como
 * parámetros: el hook los posee y los devuelve.
 *
 * El efecto se registra UNA vez por montaje. Sus dependencias son únicamente
 * setters estables de zustand; el idioma se lee con `tRef.current` y NO va en las
 * dependencias, porque si fuera así cada cambio de idioma desmontaría y volvería
 * a montar los ~21 listeners (con hueco para perder eventos) y re-invocaría
 * `connect()`.
 */
export default function useGameSocket({ invitedCodeRef }) {
  const { t } = useT();

  // Ojo: NO se hace `useGameStore()` aquí. Suscribirse haría que este hook (y con
  // él App) se re-renderizara en cada cambio del store sin necesidad: los
  // listeners no pintan nada, sólo escriben. El estado que necesitan lo leen
  // fresco con `getState()` dentro de cada handler.

  // Estado propio de esta capa (lo alimentan exclusivamente los listeners).
  const [legendaryEffect, setLegendaryEffect] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [showTournamentEntry, setShowTournamentEntry] = useState(false);
  const [searchingRanked, setSearchingRanked] = useState(false);
  const [incomingInvite, setIncomingInvite] = useState(null);
  const [friendNotice, setFriendNotice] = useState('');

  // Los handlers se registran una sola vez, así que no pueden capturar valores
  // del render (serían siempre los del primer montaje). Para el store se usa
  // `getState()`; para lo que no vive en él, un espejo en ref.
  const tRef = useRef(t);
  tRef.current = t;
  const tournamentRef = useRef(tournament);
  tournamentRef.current = tournament;

  // Estado anterior de la partida, para detectar transiciones (fin de ronda /
  // fin de juego). Lo comparten los listeners y las acciones que salen de una
  // sala, de ahí que se exponga junto a un reseteador.
  const prevGameStatusRef = useRef(null);
  const resetGameStatus = () => { prevGameStatusRef.current = null; };

  useEffect(() => {
    // Los setters de zustand se crean una sola vez con el store, así que
    // capturarlos aquí es seguro y deja el array de dependencias casi vacío
    // (menos cosas que puedan re-registrar los 21 listeners por accidente).
    const {
      setPlayerId, setRoomId, setGameState, setError, setIsConnected,
      setQuickNotifications, setPublicRooms, setRoomsLoading, setLobbyStats,
      setSpectating, setLiveGames, setEpicMoment, setInvitedCode
    } = useGameStore.getState();

    socket.connect();

    function onConnect() {
      setIsConnected(true);
      setError('');

      // Handshake de sesión: presenta la identidad + token guardado para que el
      // servidor VINCULE el socket a este jugador antes de cualquier operación
      // social/económica.
      const persistId = getOrCreatePersistentPlayerId();
      const savedName = localStorage.getItem('domino_username');
      socket.emit('hello', { playerId: persistId, token: localStorage.getItem('domino_session_token') || undefined });

      // Sincronizar skins del perfil guardado en BD
      socket.emit('get_profile', { username: savedName || 'Jugador' });

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

    // El servidor confirma la sesión y emite un token firmado (renovado en cada
    // conexión): lo guardamos para reenviarlo en el próximo 'hello'.
    function onSession(data) {
      if (!data) return;
      if (data.token) {
        try { localStorage.setItem('domino_session_token', data.token); } catch (e) { /* noop */ }
        return;
      }
      // Sin token y sin autenticar: el id guardado ya está reclamado y no hemos
      // podido demostrar que sea nuestro (token caducado tras medio año sin
      // jugar, o localStorage a medias). El servidor no vincula el socket, así
      // que perfil, tienda y amigos fallarían en silencio para siempre. Se
      // empieza una identidad nueva para no dejar al jugador atascado.
      if (data.authed === false && data.reason === 'reclamada') {
        try {
          localStorage.removeItem('domino_session_token');
          localStorage.removeItem('domino_persistent_player_id');
        } catch (e) { /* noop */ }
        const fresh = getOrCreatePersistentPlayerId();
        setPlayerId(fresh);
        socket.emit('hello', { playerId: fresh });
        socket.emit('get_profile', { username: localStorage.getItem('domino_username') || 'Jugador' });
      }
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
          if (!state.isSpectator) recordRoundWin(state, useGameStore.getState().playerId);

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
          const unlocked = state.isSpectator ? [] : recordGame(state, useGameStore.getState().playerId);
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
      if (msg.key && LEGENDARY[msg.key] && !useGameStore.getState().spectating) {
        const casterName = msg.params && msg.params.name;
        const gs = useGameStore.getState().gameState;
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
      setQuickNotifications(prev => [...prev, {
        id,
        playerName: msg.playerName,
        text: msg.text,
        msgKey: msg.key,
        params: msg.params,
        type: msg.type,
        xOffset: Math.floor(Math.random() * 60) - 30
      }]);

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
      if (useGameStore.getState().spectating) {
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
      // Se envía `name` como respaldo: normalmente el jugador ya está sentado en
      // la sala clasificatoria y esto es una reconexión, pero si no se le
      // encontrara el servidor rechazaría el join por falta de nombre.
      // Se lee de localStorage (no del estado) para no capturar un valor viejo.
      const savedName = localStorage.getItem('domino_username') || undefined;
      socket.emit('join_room', { roomId: mmRoomId, playerId: mmPlayerId, name: savedName });
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
      setError(tRef.current('end.kicked', { name: by || '—' }));
      setTimeout(() => setError(''), 6000);
    }

    const listeners = {
      connect: onConnect,
      disconnect: onDisconnect,
      session: onSession,
      room_created: onRoomCreated,
      room_joined: onRoomJoined,
      game_state: onGameState,
      play_sound: onPlaySound,
      receive_quick_message: onReceiveQuickMessage,
      error_msg: onErrorMsg,
      rooms_list: onRoomsList,
      live_games: onLiveGames,
      lobby_stats: onLobbyStats,
      kicked: onKicked,
      spectating: onSpectating,
      room_closed: onRoomClosed,
      profile_data: onProfileBoot,
      tournament_state: onTournamentState,
      tournament_error: onTournamentError,
      match_found: onMatchFound,
      friend_invited: onFriendInvited,
      friend_incoming: onFriendIncoming
    };

    // Registrar y desregistrar recorriendo el mismo mapa: antes eran dos listas
    // paralelas de 21 líneas cada una y bastaba olvidar un `off` para dejar un
    // listener colgado en cada remontaje.
    for (const [evento, handler] of Object.entries(listeners)) socket.on(evento, handler);
    return () => {
      for (const [evento, handler] of Object.entries(listeners)) socket.off(evento, handler);
    };
    // Una sola dependencia, y es un ref (identidad estable): los 21 listeners se
    // registran UNA vez por montaje y no hay forma de que un cambio de estado o
    // de idioma los re-registre. Antes el array tenía 13 setters y bastaba que
    // uno dejara de ser estable para reconectar el socket en cada render.
    // `t` no va aquí a propósito: los handlers leen el idioma con tRef.current.
  }, [invitedCodeRef]);

  return {
    legendaryEffect, setLegendaryEffect,
    tournament, setTournament,
    showTournamentEntry, setShowTournamentEntry,
    searchingRanked, setSearchingRanked,
    incomingInvite, setIncomingInvite,
    friendNotice,
    resetGameStatus
  };
}
