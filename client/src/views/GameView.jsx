import React, { useEffect, useState } from 'react';
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
import { useLineaStore, acciones as vozAcciones } from '../voice/useLineaStore';

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
 *
 * El tablero va ANTES que la barra en el DOM y la barra vuelve arriba con
 * `order: -1`: así la tabulación entra directa en lo que se juega y no recorre
 * primero idioma, voz, tienda, ranking, silencio y salir.
 */

// La barra es lo último del DOM y lo primero de la pantalla.
const ORDEN_BARRA = -1;

// Cuánto se queda en pantalla cada aviso de la línea antes de drenarse. Es el
// mismo orden de magnitud que los toques rápidos de la mesa: lo bastante para
// leerlo, no tanto como para tapar la jugada siguiente.
const AVISO_VISIBLE_MS = 5000;

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
    quickNotifications, epicMoment
  } = useGameStore();

  const Tablero = obtenerTablero(gameState.gameType);

  /**
   * LA CRÓNICA ES LA ÚNICA VOZ DE LA LÍNEA DENTRO DE LA PARTIDA. Sus avisos
   * («Ana entró en la voz», «No hemos podido conectar con Luis») entran por la
   * MISMA región `role="log"` que ya usa la mesa, y no por una región propia:
   * el CONTRATO §7 fija tres regiones vivas en la partida y las dos
   * `role="alert"` están gastadas en los avisos de reloj. Es además el
   * semántico correcto — es un registro de lo que ha pasado, exactamente como
   * «Bruno pasó turno».
   */
  const avisosDeVoz = useLineaStore((s) => s.avisos);
  useEffect(() => {
    if (avisosDeVoz.length === 0) return undefined;
    // De uno en uno y por el más antiguo: la cola está acotada a 20 y drenarla
    // entera de golpe haría que un lector locutara veinte líneas seguidas.
    const reloj = setTimeout(() => vozAcciones.descartarAviso(avisosDeVoz[0].id), AVISO_VISIBLE_MS);
    return () => clearTimeout(reloj);
  }, [avisosDeVoz]);

  return (
    // Sin `my-turn-active`: el pulso verde infinito del borde de pantalla late
    // durante todo el turno a 2,19:1 y no lo apaga ningún bloque de movimiento
    // reducido. Que es tu turno lo dicen ahora tres canales que no se solapan:
    // tu chip de la cinta, los botones vivos del riel y su línea de estado.
    <div className="app-container">
      <SpyReveal gameState={gameState} playerId={playerId} />

      {legendaryEffect && <LegendaryEffect effect={legendaryEffect} onClose={onCloseLegendary} />}

      {epicMoment && <EpicMoment moment={epicMoment} gameState={gameState} playerId={playerId} />}

      {/* Crónica de la mesa: la segunda de las tres regiones vivas de la
          partida. `role="log"` implica `aria-relevant="additions"`, así que el
          lector sólo locuta el aviso nuevo y no vuelve a leer los anteriores.
          El contenedor se pinta siempre, también vacío: una región viva que
          aparece a la vez que su primer mensaje no se anuncia. */}
      <div role="log" aria-live="polite">
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

        {avisosDeVoz.map((aviso) => (
          <div key={aviso.id} className="floating-toast floating-toast-linea">
            <span className="floating-toast-sender">{t('voice.short')}</span>
            <span className="floating-toast-text">
              {formatMessage(t, aviso.key, aviso.params)}
            </span>
          </div>
        ))}
      </div>

      <Tablero
        gameState={gameState}
        playerId={playerId}
        onLeave={actions.handleLeaveRoom}
        actions={actions}
        isMyTurn={isMyTurn}
        onOpenBracket={() => setShowBracket(true)}
      />

      {/* Detrás del tablero en el DOM, delante en pantalla. Ya no lleva ni la
          píldora de turno ni el reloj: los dos se han mudado a la cinta, que es
          donde está la persona a la que le toca. */}
      <GameBar
        players={gameState.players}
        playerId={playerId}
        roundNumber={gameState.roundNumber}
        teamsEnabled={gameState.teamsEnabled}
        teamScores={gameState.teamScores || [0, 0]}
        maxScore={gameState.maxScore}
        onLeave={actions.handleLeaveRoom}
        onOpenLeaderboard={() => setShowLeaderboard(true)}
        onOpenStore={() => setShowStore(true)}
        style={{ order: ORDEN_BARRA }}
      />

      {showBracket && <TournamentBracket gameState={gameState} onClose={() => setShowBracket(false)} />}

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {showStore && (
        <SkinStoreModal playerId={getOrCreatePersistentPlayerId()} name={name} onClose={() => setShowStore(false)} />
      )}

      <EndGameModal
        key={`end-${gameState.status}-${gameState.roundNumber}`}
        gameState={gameState}
        playerId={playerId}
        tournamentMatch={!!tournament}
      />
    </div>
  );
}
