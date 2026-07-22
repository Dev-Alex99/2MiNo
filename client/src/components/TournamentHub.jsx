import React, { useState } from 'react';
import { Trophy, X, Crown, Swords, Play, Loader2, LogOut, Users, Hourglass, Copy, Check } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

// Hub del torneo (1–4 humanos + bots). Muestra el lobby con código, el cuadro en
// vivo y el resultado. El estado llega personalizado por humano (marca su plaza).
export default function TournamentHub({ tournament, onStart, onPlayMatch, onExit }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  if (!tournament) return null;

  const { status, seeds, bracket, championSeed, youSeed, yourMatchRoomId, reward, runnerUp, humans = [], isHost, code } = tournament;

  const copyCode = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard bloqueado */ }
  };

  // ─── Lobby: esperando jugadores ───
  if (status === 'lobby') {
    const slots = [];
    for (let i = 0; i < 4; i++) {
      slots.push(humans[i] ? { name: humans[i].name, filled: true } : { name: t('tourney.waiting'), filled: false });
    }
    return (
      <div className="modal-overlay animate-fade-in">
        <div className="modal-card glass-panel animate-scale-up bracket-modal-card" onClick={(e) => e.stopPropagation()}>
          <button className="profile-close" onClick={onExit} aria-label={t('tourney.exit')}><X size={18} /></button>

          <div className="bracket-header">
            <Trophy size={26} className="bracket-trophy-icon" />
            <div>
              <h3 className="bracket-title">{t('tourney.hubTitle')}</h3>
              <span className="bracket-subtitle">{t('tourney.hubSub', { reward })}</span>
            </div>
          </div>

          <button type="button" className="tourney-code-box" onClick={copyCode} title={t('tourney.copyCode')}>
            <span className="tourney-code-label">
              {copied ? <><Check size={11} /> {t('tourney.copied')}</> : <><Copy size={11} /> {t('tourney.shareCode')}</>}
            </span>
            <span className="tourney-code">{code}</span>
          </button>

          <div className="tourney-players">
            <div className="profile-section-label"><Users size={14} /> {t('tourney.players')} ({humans.length}/4)</div>
            {slots.map((s, i) => (
              <div key={i} className={`tourney-player-slot ${s.filled ? 'filled' : ''}`}>
                <span className="tourney-slot-num">{i + 1}</span>
                <span className="tourney-slot-name">{s.name}</span>
                {s.filled && i === 0 && <Crown size={12} className="text-amber-400" title={t('tourney.host')} />}
              </div>
            ))}
            <p className="tourney-fill-note">{t('tourney.fillNote')}</p>
          </div>

          <div className="tourney-cta">
            {isHost ? (
              <button className="btn-premium btn-primary tourney-cta-btn" onClick={onStart}>
                <Play size={18} /> {t('tourney.start')}
              </button>
            ) : (
              <div className="tourney-resolving"><Hourglass size={16} /> {t('tourney.waitHost')}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Activo / terminado: cuadro ───
  if (!bracket || !bracket.final || !bracket.sf1 || !bracket.sf2) return null; // payload parcial
  const nameOf = (i) => (i == null ? '—' : (i === youSeed ? t('tourney.you') : (seeds?.[i]?.name || '—')));
  const Player = ({ seedIdx, isWinner }) => (
    <div className={`bracket-player ${isWinner ? 'winner' : ''} ${seedIdx === youSeed ? 'is-human' : ''}`}>
      <span className="bracket-seed">{seedIdx != null ? seedIdx + 1 : '?'}</span>
      <span className="bracket-name">{nameOf(seedIdx)}</span>
      {isWinner && <Crown size={12} className="text-amber-400" />}
    </div>
  );

  // Situación del humano en el cuadro.
  const inFinal = youSeed === bracket.final.a || youSeed === bracket.final.b;
  const mySemi = (youSeed === 0 || youSeed === 1) ? 'sf1' : 'sf2';
  const mySemiWinner = bracket[mySemi] ? bracket[mySemi].winner : null;
  const eliminated = mySemiWinner != null && mySemiWinner !== youSeed && !inFinal;

  return (
    <div className="modal-overlay animate-fade-in">
      <div className="modal-card glass-panel animate-scale-up bracket-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-close" onClick={onExit} aria-label={t('tourney.exit')}><X size={18} /></button>

        <div className="bracket-header">
          <Trophy size={26} className="bracket-trophy-icon" />
          <div>
            <h3 className="bracket-title">{t('tourney.hubTitle')}</h3>
            <span className="bracket-subtitle">{t('tourney.hubSub', { reward })}</span>
          </div>
        </div>

        <div className="bracket-grid">
          <div className="bracket-column">
            <div className="bracket-phase-title"><Swords size={14} /> {t('tourney.semis')}</div>
            <div className={`bracket-match-box ${bracket.sf1.winner != null ? 'active' : ''}`}>
              <Player seedIdx={0} isWinner={bracket.sf1.winner === 0} />
              <Player seedIdx={1} isWinner={bracket.sf1.winner === 1} />
            </div>
            <div className={`bracket-match-box ${bracket.sf2.winner != null ? 'active' : ''}`}>
              <Player seedIdx={2} isWinner={bracket.sf2.winner === 2} />
              <Player seedIdx={3} isWinner={bracket.sf2.winner === 3} />
            </div>
          </div>

          <div className="bracket-connector"><div className="bracket-line" /></div>

          <div className="bracket-column final-column">
            <div className="bracket-phase-title gold"><Crown size={14} /> {t('tourney.final')}</div>
            <div className={`bracket-match-box final-match ${bracket.final.a != null ? 'active' : ''}`}>
              <Player seedIdx={bracket.final.a} isWinner={championSeed != null && championSeed === bracket.final.a} />
              <Player seedIdx={bracket.final.b} isWinner={championSeed != null && championSeed === bracket.final.b} />
            </div>
            {championSeed != null && (
              <div className="bracket-champion-box animate-scale-up">
                <Crown size={22} className="text-amber-400" />
                <span className="bracket-champ-label">{t('tourney.champion')}</span>
                <span className="bracket-champ-name">{nameOf(championSeed)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="tourney-cta">
          {status === 'active' && yourMatchRoomId && (
            <button className="btn-premium btn-primary tourney-cta-btn" onClick={onPlayMatch}>
              <Swords size={18} /> {t('tourney.playMatch')}
            </button>
          )}
          {status === 'active' && !yourMatchRoomId && eliminated && (
            <div className="tourney-result">
              <div className="tourney-result-banner lose">{t('tourney.eliminated')}</div>
              <button className="btn-premium btn-secondary tourney-cta-btn" onClick={onExit}>
                <LogOut size={16} /> {t('tourney.exit')}
              </button>
            </div>
          )}
          {status === 'active' && !yourMatchRoomId && !eliminated && (
            <div className="tourney-resolving"><Loader2 size={16} className="voice-spin" /> {t('tourney.waitOther')}</div>
          )}

          {status === 'finished' && (() => {
            const wasFinalist = youSeed === bracket.final.a || youSeed === bracket.final.b;
            const iWon = championSeed === youSeed;
            let banner;
            if (iWon) banner = t('tourney.championYou', { reward });
            else if (wasFinalist) banner = t('tourney.runnerUp', { reward: runnerUp });
            else banner = t('tourney.championOther', { name: nameOf(championSeed) });
            return (
              <div className="tourney-result">
                <div className={`tourney-result-banner ${iWon ? 'win' : (wasFinalist ? 'runner' : 'lose')}`}>
                  {banner}
                </div>
                <button className="btn-premium btn-secondary tourney-cta-btn" onClick={onExit}>
                  <LogOut size={16} /> {t('tourney.exit')}
                </button>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
