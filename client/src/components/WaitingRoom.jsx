import React, { useState } from 'react';
import { Copy, Check, Users, Sparkles, LogOut, CheckCircle2, Zap, Layers, Medal, Bot, X, Download, ArrowLeftRight, Crown, UserX, Share2 } from 'lucide-react';
import { socket } from '../socket';
import LineaCapsula from '../voice/LineaCapsula';
import LanguageSwitcher from './LanguageSwitcher';
import { useT } from '../i18n/LanguageContext';
import { capacidadesDe } from '../games/registry';
import { colorDeJugador } from '../utils/colorDeJugador';
import RoomChat from './RoomChat';

export default function WaitingRoom({ gameState, playerId, onLeave }) {
  const { t } = useT();
  const BOT_LEVELS = [
    { id: 'facil', label: t('wait.difEasy') },
    { id: 'normal', label: t('wait.difNormal') },
    { id: 'dificil', label: t('wait.difHard') },
    { id: 'maestro', label: t('wait.difMaster') }
  ];
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [botLevel, setBotLevel] = useState('normal');
  const [swapFrom, setSwapFrom] = useState(null);
  // Confirmación EN SU SITIO de lo destructivo: `{ tipo, id }`. Expulsar y
  // quitar bot disparaban al PRIMER clic sobre objetivos de 26 px pegados a
  // otros botones. Ahora el primer toque abre dos botones de 40 con su texto
  // completo, y no hay ni modal nuevo ni `window.confirm`.
  const [confirmando, setConfirmando] = useState(null);
  const me = gameState.players.find(p => p.id === playerId);
  const totalPlayers = gameState.players.length;
  // Capacidades y aforo del juego de ESTA sala. `isFull` estaba fijado a 4:
  // en una mesa de dos (tres en raya) el botón de añadir bot seguía activo con
  // la sala llena, y el servidor rechazaba la petición sin más.
  const juego = capacidadesDe(gameState.gameType);
  const maxPlayers = gameState.maxPlayers ?? 4;
  const isFull = totalPlayers >= maxPlayers;

  const addBot = () => {
    // Guarda de manejador, además del atributo: es la mitad del patrón que pide
    // el CONTRATO §10 y la única que puedo poner hoy (ver el botón, abajo).
    if (isFull) return;
    socket.emit('add_bot', { roomId: gameState.roomId, difficulty: botLevel });
  };

  const removeBot = (botId) => {
    setConfirmando(null);
    socket.emit('remove_bot', { roomId: gameState.roomId, botId });
  };

  const amHost = gameState.hostId === playerId;
  const kickPlayer = (targetId) => {
    setConfirmando(null);
    socket.emit('kick_player', { targetId });
  };

  const pidiendo = (tipo, id) => confirmando && confirmando.tipo === tipo && confirmando.id === id;

  // Intercambio de asientos: se elige uno y luego con quién cambiarlo.
  const handleSwapClick = (id) => {
    if (!swapFrom) return setSwapFrom(id);
    if (swapFrom === id) return setSwapFrom(null);
    socket.emit('swap_seats', { roomId: gameState.roomId, playerA: swapFrom, playerB: id });
    setSwapFrom(null);
  };

  // Si el jugador elegido se va de la sala, cancelamos la selección.
  const swapFromExists = gameState.players.some(p => p.id === swapFrom);
  if (swapFrom && !swapFromExists) setSwapFrom(null);

  const swapFromName = gameState.players.find(p => p.id === swapFrom)?.name;

  const copyCode = () => {
    navigator.clipboard.writeText(gameState.roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Enlace de invitación directo: al abrirlo, el amigo entra a esta sala sin
  // teclear el código. En móvil usa el menú nativo de compartir si existe.
  const inviteLink = `${window.location.origin}/${gameState.roomId}`;
  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Dominó Online',
          text: t('wait.shareText', { code: gameState.roomId }),
          url: inviteLink
        });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // el usuario canceló
        // cualquier otro fallo: caemos a copiar al portapapeles
      }
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* portapapeles bloqueado */ }
  };

  const handleToggleReady = () => {
    socket.emit('toggle_ready', { roomId: gameState.roomId, playerId });
  };

  return (
    <div className="waiting-room-screen">
      <div className="waiting-room-card glass-panel animate-scale-up">
        
        {/* Cabecera Sala */}
        <div className="waiting-room-header-row">
          <div>
            <span className="waiting-room-header-subtitle">
              <Sparkles size={12} /> {t('wait.subtitle')}
            </span>
            <h2 className="waiting-room-header-title">{t('wait.title')}</h2>

            {/* Modalidad fijada por el anfitrión al crear la sala.
                Son etiquetas del DOMINÓ (variante, parejas, pozo, poderes,
                puntos): en una sala de otro juego anunciaban "Doble 6" y
                "100 puntos" de cosas que ahí no existen. */}
            <div className="room-mode-tags">
              {juego.opcionesDeSala ? (
                <>
                  <span className="room-mode-tag">
                    <Layers size={11} />
                    {t('opt.double', { n: gameState.maxPip ?? 6 })}
                  </span>
                  {gameState.teamsEnabled && (
                    <span className="room-mode-tag teams">
                      <Users size={11} />
                      {t('rooms.teams')} 2v2
                    </span>
                  )}
                  {gameState.drawEnabled === false && (
                    <span className="room-mode-tag">
                      <Download size={11} />
                      {t('rooms.noDraw')}
                    </span>
                  )}
                  <span className={`room-mode-tag ${gameState.powersEnabled === false ? '' : 'accent'}`}>
                    <Zap size={11} />
                    {gameState.powersEnabled === false ? t('mode.classic') : t('mode.withPowers')}
                  </span>
                  <span className="room-mode-tag">
                    <Medal size={11} />
                    {gameState.maxScore ?? 100} {t('common.points')}
                  </span>
                </>
              ) : (
                <span className="room-mode-tag accent">
                  <Sparkles size={11} />
                  {juego.nombre}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <LanguageSwitcher compact />
            <button
              onClick={onLeave}
              className="waiting-room-leave-btn"
              title={t('wait.leave')}
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {/* Rejilla modular de la sala */}
        <div className="waiting-room-grid">
          {/* Módulo 1: Sala (Código y Voz) */}
          <div className="waiting-module waiting-module-info">
            <div className="code-box">
              <span className="code-box-header">{t('wait.codeHeader')}</span>
              <div className="code-box-row">
                <span className="code-box-value">{gameState.roomId}</span>
                {/* El `title` decía `wait.copied` («¡Código copiado al
                    portapapeles!»), que es el mensaje POSTERIOR: un lector anunciaba
                    que ya se había copiado ANTES de pulsar. El aviso de que se
                    copió ya existe abajo, en `code-box-copy-toast`. */}
                <button
                  onClick={copyCode}
                  className="code-box-copy-btn"
                  title={t('friend.copyCode')}
                  aria-label={t('friend.copyCode')}
                >
                  {copied ? <Check size={18} style={{ color: '#10b981' }} /> : <Copy size={18} />}
                </button>
              </div>
              <button onClick={shareLink} className="code-box-share-btn">
                {linkCopied ? <Check size={15} /> : <Share2 size={15} />}
                {linkCopied ? t('wait.linkCopied') : t('wait.shareLink')}
              </button>
              {copied && <span className="code-box-copy-toast">{t('wait.copied')}</span>}
            </div>

            {/* La voz, disponible ya desde aquí para coordinaros antes de empezar:
                la llamada sigue viva al arrancar la partida, porque el motor vive
                por encima del router. El timbre y la hoja NO se montan aquí — son
                de `LineaGlobal`, que es su único dueño; esto es sólo el control. */}
            <div className="waiting-room-voz">
              <LineaCapsula variante="sala" />
            </div>
          </div>

          {/* Módulo 2: Lista de Jugadores */}
          <div className="waiting-module waiting-module-players">
            <div className="waiting-players-section">
              <div className="waiting-players-header">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Users size={14} /> {t('wait.players', { n: totalPlayers, max: maxPlayers })}
                </span>
                <span>{t('wait.status')}</span>
              </div>

              {/* Pista del intercambio en curso */}
              {swapFrom && (
                <div className="swap-hint">
                  <ArrowLeftRight size={13} />
                  <span>{t('wait.swapHint', { name: swapFromName })}</span>
                  <button onClick={() => setSwapFrom(null)} className="select-hint-cancel">
                    {t('common.cancel')}
                  </button>
                </div>
              )}

              {gameState.teamsEnabled && !swapFrom && (
                <div className="swap-tip">
                  {t('wait.swapTip')}
                </div>
              )}

              <div className="waiting-players-list">
                {gameState.players.map((player) => (
                  <div 
                    key={player.id}
                    className={`player-row ${player.id === playerId ? 'me' : ''}`}
                  >
                    <div className="player-row-left">
                      {/* El color sale del id, no del nombre: es el MISMO que va a
                          llevar esta persona en su chip de la cinta durante la
                          partida, así que la mesa se lee igual desde la sala. */}
                      <div
                        className="player-avatar"
                        style={{ background: colorDeJugador(player.id) }}
                      >
                        {player.isBot
                          ? <Bot size={15} />
                          : (player.avatar || player.name.substring(0, 2).toUpperCase())}
                      </div>
                      <div className="player-row-name-box">
                        <span className="player-row-name">
                          {player.name}
                          {player.id === gameState.hostId && (
                            <Crown size={12} className="host-crown" aria-label={t('wait.host')} />
                          )}
                          {player.id === playerId && (
                            <span className="player-badge-me">{t('common.you')}</span>
                          )}
                          {player.isBot && <span className="player-badge-bot">{t('wait.bot')}</span>}
                        </span>
                        <span className="player-row-role">
                          {gameState.teamsEnabled && (
                            <span className={`team-chip team-${player.team}`}>
                              {player.team === 0 ? t('team.a') : t('team.b')}
                            </span>
                          )}
                          {player.isBot
                            ? (BOT_LEVELS.find(l => l.id === player.difficulty)?.label || t('wait.difNormal'))
                            : t('wait.player')}
                        </span>
                      </div>
                    </div>

                    {/* Estado Ready / cambiar sitio / quitar bot */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {player.ready ? (
                        <span className="badge-ready">{t('wait.ready')}</span>
                      ) : (
                        <span className="badge-waiting">{t('wait.waiting')}</span>
                      )}

                      {totalPlayers > 1 && (
                        <button
                          onClick={() => handleSwapClick(player.id)}
                          className={`seat-swap-btn ${swapFrom === player.id ? 'active' : ''} ${swapFrom && swapFrom !== player.id ? 'target' : ''}`}
                          title={
                            swapFrom === player.id
                              ? t('common.cancel')
                              : t('wait.swapHint', { name: player.name })
                          }
                          aria-label={t('wait.swapHint', { name: player.name })}
                        >
                          <ArrowLeftRight size={13} />
                        </button>
                      )}

                      {/* Quitar bot y expulsar: el primer toque NO dispara. Abre
                          en su sitio dos botones de 40 px con el texto completo, así
                          que lo que se pulsa por accidente es un icono que sólo
                          pregunta. Mismo patrón que el [Salir] de la barra. */}
                      {player.isBot && (
                        pidiendo('bot', player.id) ? (
                          <span className="ov-confirmar">
                            <button
                              onClick={() => removeBot(player.id)}
                              className="btn-premium ov-peligro"
                            >
                              {t('wait.removeBot', { name: player.name })}
                            </button>
                            <button className="btn-premium btn-secondary" onClick={() => setConfirmando(null)}>
                              {t('common.cancel')}
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmando({ tipo: 'bot', id: player.id })}
                            className="bot-remove-btn"
                            title={t('wait.removeBot', { name: player.name })}
                            aria-label={t('wait.removeBot', { name: player.name })}
                          >
                            <X size={14} />
                          </button>
                        )
                      )}

                      {/* Expulsar: solo el admin, y solo a otros humanos. */}
                      {amHost && !player.isBot && player.id !== playerId && (
                        pidiendo('kick', player.id) ? (
                          <span className="ov-confirmar">
                            <button
                              onClick={() => kickPlayer(player.id)}
                              className="btn-premium ov-peligro"
                            >
                              {t('wait.kick', { name: player.name })}
                            </button>
                            <button className="btn-premium btn-secondary" onClick={() => setConfirmando(null)}>
                              {t('common.cancel')}
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmando({ tipo: 'kick', id: player.id })}
                            className="bot-remove-btn"
                            title={t('wait.kick', { name: player.name })}
                            aria-label={t('wait.kick', { name: player.name })}
                          >
                            <UserX size={14} />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}

                {/* Ranuras vacías */}
                {/* Tantas ranuras como plazas le queden a ESTE juego: con un 4 fijo, una
                    sala de tres en raya (2 plazas) se pintaba como una mesa de cuatro. */}
                {Array.from({ length: Math.max(0, maxPlayers - totalPlayers) }).map((_, idx) => (
                  <div key={`empty-${idx}`} className="player-row-empty">
                    <div className="empty-avatar">?</div>
                    <span>{t('wait.emptySlot')}</span>
                  </div>
                ))}
              </div>

              {/* Rellenar con bots: no hace falta esperar a nadie para jugar */}
              <div className="bot-add-box">
                <span className="bot-add-label">
                  <Bot size={13} />
                  {t('wait.addBot')}
                </span>
                <div className="bot-add-controls">
                  <div className="bot-level-group" role="group" aria-label={t('wait.botDifficulty')}>
                    {BOT_LEVELS.map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => setBotLevel(lvl.id)}
                        aria-pressed={botLevel === lvl.id}
                        className={`bot-level-btn ${botLevel === lvl.id ? 'active' : ''}`}
                      >
                        {lvl.label}
                      </button>
                    ))}
                  </div>
                  {/* CONSERVA EL ATRIBUTO `disabled`, QUE EL CONTRATO §10 PROHÍBE,
                      y no por descuido: `flujos.test.jsx:228` (de P7-VESTIBULO)
                      afirma `toBeDisabled()` sobre este botón, y `toBeDisabled` de
                      jest-dom NO mira `aria-disabled`. Cambiarlo aquí deja rojo un
                      test de otro paquete que no puedo tocar. Va `aria-disabled`
                      además, para que un lector lo anuncie, y la guarda ya está en
                      el manejador: cuando P7 afloje la aserción, es una línea. */}
                  <button
                    onClick={addBot}
                    disabled={isFull}
                    aria-disabled={isFull}
                    className="btn-premium btn-secondary bot-add-btn"
                    title={isFull ? t('wait.tableFull') : t('wait.addBot')}
                  >
                    <Bot size={15} />
                    {isFull ? t('wait.tableFull') : t('wait.add')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Módulo 3: Chat integrado de la sala */}
          <div className="waiting-module waiting-module-chat">
            <RoomChat roomId={gameState.roomId} playerId={playerId} />
          </div>

          {/* Módulo 4: Panel de control "Listo" */}
          <div className="waiting-module waiting-module-action">
            <div className="waiting-footer">
              <button
                onClick={handleToggleReady}
                className={`btn-premium ${me?.ready ? 'btn-secondary' : 'btn-primary'}`}
                style={{ width: '100%', padding: '16px', fontSize: '1.05rem' }}
              >
                {me?.ready ? t('wait.cancelReady') : t('wait.markReady')}
              </button>

              <div className="waiting-footer-desc">
                {gameState.teamsEnabled && totalPlayers < maxPlayers
                  ? t('wait.teamsNeed', { n: maxPlayers - totalPlayers })
                  : totalPlayers < 2
                    ? t('wait.needPlayers')
                    : t('wait.willStart')
                }
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
