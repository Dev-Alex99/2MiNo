import React, { useState } from 'react';
import { Volume2, VolumeX, LogOut, Layers, Trophy, ShoppingBag } from 'lucide-react';
import { toggleMute, getMuteState } from '../audio';
import LineaCapsula from '../voice/LineaCapsula';
import LanguageSwitcher from './LanguageSwitcher';
import { useT } from '../i18n/LanguageContext';

/**
 * Barra única de la partida, en móvil y en escritorio.
 *
 * Sustituye a la barra lateral de 320px: con la cinta de turno mostrando nombre,
 * fichas, turno y cara, el marcador lateral repetía lo mismo ocupando un tercio
 * de la pantalla.
 *
 * Ya NO lleva la señal de turno ni el reloj. La píldora era texto de 0,65rem a
 * 4,25:1 con `max-width: 105px` en móvil, y el reloj no escalaba urgencia: los
 * dos se han mudado al chip de la cinta, donde el canto de la persona a la que
 * le toca ES la cuenta atrás. Aquí quedan las tres cosas que no son del turno:
 * ronda, marcador y acciones.
 *
 * `style` existe para una sola cosa: GameView la monta DESPUÉS del tablero para
 * que la tabulación entre directa en la mesa, y le devuelve su sitio en pantalla
 * con `order: -1`. Las dos mitades de esa decisión tienen que leerse juntas, así
 * que el número vive allí y no aquí.
 */
export default function GameBar({
  players, playerId, roundNumber, teamsEnabled, teamScores, maxScore, onLeave,
  onOpenLeaderboard, onOpenStore, style
}) {
  const { t } = useT();
  const [muted, setMuted] = useState(getMuteState());
  const [confirmLeave, setConfirmLeave] = useState(false);

  const me = players.find(p => p.id === playerId);

  return (
    <div className="game-bar" style={style}>
      <span className="game-bar-round">
        <Layers size={11} />
        R{roundNumber || 1}
      </span>

      {teamsEnabled ? (
        <span className="game-bar-score">
          <b className="team-0">{teamScores[0]}</b>
          <span className="game-bar-sep">–</span>
          <b className="team-1">{teamScores[1]}</b>
        </span>
      ) : (
        <span className="game-bar-score">
          <b>{me ? me.score : 0}</b>
          <span className="game-bar-sep">/{maxScore}</span>
        </span>
      )}

      <div className="game-bar-actions">
        <div className="game-bar-lang">
          <LanguageSwitcher compact />
        </div>
        {/* La voz dentro de la partida, por fin con superficie. Donde estaba
            `<VoiceChat/>` había un nodo que `perfil-hub.css:2090` escondía con
            `display:none`: el chat de voz existía en el DOM de la barra y no se
            veía. Ahora es un chip de 32 px que en reposo dice «Entrar a la voz»
            y con la línea viva la resume y abre la hoja. No cambia el reparto
            vertical: su área táctil de 44 la pone un pseudo-elemento. */}
        <LineaCapsula variante="anclada" />

        {/* Los dos son sólo icono: sin `aria-label` no tienen nombre accesible,
            porque `title` no basta en todos los lectores y en táctil no se ve
            nunca. Y los dos textos pasan por t(): estaban en español duro, y el
            del ranking además nombraba al proveedor («Supabase»), que es
            fontanería y no le dice nada a quien juega. */}
        {onOpenStore && (
          <button
            onClick={onOpenStore}
            className="mute-btn"
            title={t('bar.tienda')}
            aria-label={t('bar.tienda')}
            style={{ color: '#fbbf24' }}
          >
            <ShoppingBag size={14} color="#fbbf24" />
          </button>
        )}

        {onOpenLeaderboard && (
          <button
            onClick={onOpenLeaderboard}
            className="mute-btn"
            title={t('bar.ranking')}
            aria-label={t('bar.ranking')}
          >
            <Trophy size={14} color="#f59e0b" />
          </button>
        )}

        <button
          onClick={() => setMuted(toggleMute())}
          className={`mute-btn ${muted ? 'active' : ''}`}
          title={muted ? t('game.soundOn') : t('game.soundOff')}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>

        <button
          onClick={() => setConfirmLeave(v => !v)}
          className={`mute-btn ${confirmLeave ? 'active' : ''}`}
          title={t('wait.leave')}
          aria-label={t('wait.leave')}
        >
          <LogOut size={14} />
        </button>
      </div>

      {confirmLeave && (
        <div className="leave-confirm bar-leave">
          <span className="leave-confirm-text">
            {t('game.leaveConfirm')}
          </span>
          <div className="leave-confirm-actions">
            <button onClick={onLeave} className="leave-confirm-yes">{t('game.leaveShort')}</button>
            <button onClick={() => setConfirmLeave(false)} className="leave-confirm-no">{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
