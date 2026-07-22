import React from 'react';
import { Trophy, X, Crown, Swords, Medal, CheckCircle2 } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

export default function TournamentBracket({ gameState, onClose }) {
  const { t } = useT();
  if (!gameState) return null;

  const players = gameState.players || [];
  const p1 = players[0] ? players[0].name : t('tourney.waiting');
  const p2 = players[1] ? players[1].name : t('tourney.waiting');
  const p3 = players[2] ? players[2].name : t('tourney.waiting');
  const p4 = players[3] ? players[3].name : t('tourney.waiting');

  // Si no hay torneo activo o estado de llaves, calculamos el estado por marcador
  const sorted = players.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const leader = sorted[0];
  const isFinalPhase = gameState.status === 'game_ended' || (leader && leader.score >= (gameState.maxScore || 100) * 0.75);
  const champion = gameState.status === 'game_ended' ? (players.find(p => p.id === gameState.gameWinner) || leader) : null;

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-card glass-panel animate-scale-up bracket-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-close" onClick={onClose} aria-label={t('common.cancel')}>
          <X size={18} />
        </button>

        <div className="bracket-header">
          <Trophy size={26} className="bracket-trophy-icon" />
          <div>
            <h3 className="bracket-title">{t('tourney.title')}</h3>
            <span className="bracket-subtitle">{t('tourney.subtitle')}</span>
          </div>
        </div>

        {/* Cuadro de Llaves (Bracket Grid) */}
        <div className="bracket-grid">
          {/* Columna Semifinales */}
          <div className="bracket-column">
            <div className="bracket-phase-title">
              <Swords size={14} /> {t('tourney.semis')}
            </div>

            {/* Llave 1 */}
            <div className={`bracket-match-box ${players.length >= 2 ? 'active' : ''}`}>
              <div className={`bracket-player ${players[0] && leader?.id === players[0].id ? 'winner' : ''}`}>
                <span className="bracket-seed">1</span>
                <span className="bracket-name">{p1}</span>
                <span className="bracket-score">{players[0]?.score || 0}</span>
              </div>
              <div className={`bracket-player ${players[1] && leader?.id === players[1].id ? 'winner' : ''}`}>
                <span className="bracket-seed">2</span>
                <span className="bracket-name">{p2}</span>
                <span className="bracket-score">{players[1]?.score || 0}</span>
              </div>
            </div>

            {/* Llave 2 */}
            <div className={`bracket-match-box ${players.length >= 4 ? 'active' : ''}`}>
              <div className={`bracket-player ${players[2] && leader?.id === players[2].id ? 'winner' : ''}`}>
                <span className="bracket-seed">3</span>
                <span className="bracket-name">{p3}</span>
                <span className="bracket-score">{players[2]?.score || 0}</span>
              </div>
              <div className={`bracket-player ${players[3] && leader?.id === players[3].id ? 'winner' : ''}`}>
                <span className="bracket-seed">4</span>
                <span className="bracket-name">{p4}</span>
                <span className="bracket-score">{players[3]?.score || 0}</span>
              </div>
            </div>
          </div>

          {/* Conectores / Conector de Llave */}
          <div className="bracket-connector">
            <div className="bracket-line" />
          </div>

          {/* Columna Gran Final */}
          <div className="bracket-column final-column">
            <div className="bracket-phase-title gold">
              <Crown size={14} /> {t('tourney.final')}
            </div>

            <div className={`bracket-match-box final-match ${isFinalPhase ? 'active' : ''}`}>
              <div className={`bracket-player ${champion && champion.id === sorted[0]?.id ? 'winner' : ''}`}>
                <span className="bracket-seed">🏆</span>
                <span className="bracket-name">{sorted[0] ? sorted[0].name : t('tourney.finalist', { n: 1 })}</span>
                <span className="bracket-score">{sorted[0]?.score || 0}</span>
              </div>
              <div className={`bracket-player ${champion && champion.id === sorted[1]?.id ? 'winner' : ''}`}>
                <span className="bracket-seed">🥈</span>
                <span className="bracket-name">{sorted[1] ? sorted[1].name : t('tourney.finalist', { n: 2 })}</span>
                <span className="bracket-score">{sorted[1]?.score || 0}</span>
              </div>
            </div>

            {champion && (
              <div className="bracket-champion-box animate-scale-up">
                <Crown size={22} className="text-amber-400" />
                <span className="bracket-champ-label">{t('tourney.champion')}</span>
                <span className="bracket-champ-name">{champion.name}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
