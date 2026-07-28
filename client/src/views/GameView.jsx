import React, { useState } from 'react';
import GameBar from '../components/GameBar';
import EndGameModal from '../components/EndGameModal';
import SpyReveal from '../components/SpyReveal';
import EpicMoment from '../components/EpicMoment';
import LegendaryEffect from '../components/LegendaryEffect';
import TournamentBracket from '../components/TournamentBracket';
import LeaderboardModal from '../components/LeaderboardModal';
import SkinStoreModal from '../components/SkinStoreModal';
import { obtenerTablero } from '../games/registry';
import { useT } from '../i18n/LanguageContext';
import { formatMessage } from '../i18n/format';
import { useGameStore, getOrCreatePersistentPlayerId } from '../store/useGameStore';

/**
 * La partida en curso: el marco común (barra, avisos, modales) más el tablero
 * del juego que toque, que se pide al registro.
 *
 * Vive aparte de App porque era la mitad de sus 977 líneas. Lee el estado del
 * store directamente en vez de recibir veinte props, y sólo se le pasa lo que no
 * puede saber: las acciones y el estado que posee `useGameSocket`.
 *
 * Contrato de un tablero registrado: recibe
 * `{ gameState, playerId, onLeave, actions, isMyTurn, onOpenBracket }` y puede
 * usar lo que necesite (el de dominó lee casi todo del store; el de tres en
 * raya se apaña con gameState/playerId/onLeave).
 */
export default function GameView({
  actions,
  isMyTurn,
  legendaryEffect,
  onCloseLegendary,
  tournament,
  showLeaderboard,
  setShowLeaderboard,
  showStore,
  setShowStore
}) {
  const { t } = useT();
  const [showBracket, setShowBracket] = useState(false);

  const {
    name, playerId, gameState,
    quickNotifications, showTurnBanner, epicMoment
  } = useGameStore();

  const Tablero = obtenerTablero(gameState.gameType);

  return (
    <div className={`app-container ${isMyTurn ? 'my-turn-active' : ''}`}>
      {showTurnBanner && (
        <div className="turn-splash-overlay">
          <h2 className="turn-splash-text">{t('game.yourTurn')}</h2>
        </div>
      )}

      <SpyReveal gameState={gameState} playerId={playerId} />

      {legendaryEffect && <LegendaryEffect effect={legendaryEffect} onClose={onCloseLegendary} />}

      {epicMoment && <EpicMoment moment={epicMoment} gameState={gameState} playerId={playerId} />}

      {showBracket && <TournamentBracket gameState={gameState} onClose={() => setShowBracket(false)} />}

      {quickNotifications.map((notif) => (
        notif.type === 'emoji' ? (
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
        ) : (
          <div key={notif.id} className="floating-toast">
            <span className="floating-toast-sender">
              {notif.playerName === 'SISTEMA' ? t('game.system') : notif.playerName}
            </span>
            <span className="floating-toast-text">
              {notif.msgKey ? formatMessage(t, notif.msgKey, notif.params) : notif.text}
            </span>
          </div>
        )
      ))}

      <GameBar
        players={gameState.players}
        playerId={playerId}
        roundNumber={gameState.roundNumber}
        teamsEnabled={gameState.teamsEnabled}
        teamScores={gameState.teamScores || [0, 0]}
        maxScore={gameState.maxScore}
        onLeave={actions.handleLeaveRoom}
        currentPlayerId={gameState.currentPlayerId}
        turnEndsAt={gameState.turnEndsAt}
        turnSecondsRemaining={gameState.turnSecondsRemaining}
        turnDurationSeconds={gameState.turnDurationSeconds}
        onOpenLeaderboard={() => setShowLeaderboard(true)}
        onOpenStore={() => setShowStore(true)}
      />

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {showStore && (
        <SkinStoreModal playerId={getOrCreatePersistentPlayerId()} name={name} onClose={() => setShowStore(false)} />
      )}

      <Tablero
        gameState={gameState}
        playerId={playerId}
        onLeave={actions.handleLeaveRoom}
        actions={actions}
        isMyTurn={isMyTurn}
        onOpenBracket={() => setShowBracket(true)}
      />

      <EndGameModal
        key={`end-${gameState.status}-${gameState.roundNumber}`}
        gameState={gameState}
        playerId={playerId}
        tournamentMatch={!!tournament}
      />
    </div>
  );
}
