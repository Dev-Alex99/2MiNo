// Estadísticas y logros del jugador, guardados localmente (por navegador).
// Cero coste de servidor: encaja con el modelo anónimo del juego. No sincroniza
// entre dispositivos (esa sería una Fase 2 con cuentas + base de datos).

const KEY = 'domino_stats';
const TITLE_KEY = 'domino_title';

const EMPTY = {
  played: 0,
  wins: 0,
  losses: 0,
  streak: 0,
  bestStreak: 0,
  roundsWon: 0,
  achievements: {} // id -> fecha ISO de desbloqueo
};

export const TITLES = [
  { id: 'none', icon: '👤', reqWins: 0 },
  { id: 'maestro', icon: '👑', reqWins: 1 },
  { id: 'rey_doble', icon: '🎴', reqWins: 3 },
  { id: 'invicto', icon: '🔥', reqWins: 5 },
  { id: 'cazador', icon: '🕵️', reqWins: 10 },
  { id: 'estratega', icon: '🧠', reqWins: 15 },
  { id: 'leyenda', icon: '🏆', reqWins: 25 }
];

export function getRank(s) {
  const w = s ? s.wins || 0 : 0;
  if (w >= 50) return { id: 'legend', icon: '💎', color: '#38bdf8' };
  if (w >= 25) return { id: 'gold', icon: '🥇', color: '#fbbf24' };
  if (w >= 10) return { id: 'silver', icon: '🥈', color: '#cbd5e1' };
  if (w >= 3)  return { id: 'bronze', icon: '🥉', color: '#d97706' };
  return { id: 'rookie', icon: '🟢', color: '#34d399' };
}

// División competitiva a partir del ELO (server-authoritative en clasificatoria).
// Traducción de la etiqueta con la clave i18n `div.<id>`.
export function getDivision(elo) {
  const e = Number(elo) || 1200;
  if (e >= 2100) return { id: 'legend',   icon: '👑', color: '#f43f5e', min: 2100 };
  if (e >= 1850) return { id: 'diamond',  icon: '💎', color: '#38bdf8', min: 1850 };
  if (e >= 1600) return { id: 'platinum', icon: '🛡️', color: '#22d3ee', min: 1600 };
  if (e >= 1400) return { id: 'gold',     icon: '🥇', color: '#fbbf24', min: 1400 };
  if (e >= 1250) return { id: 'silver',   icon: '🥈', color: '#cbd5e1', min: 1250 };
  if (e >= 1100) return { id: 'bronze',   icon: '🥉', color: '#d97706', min: 1100 };
  return { id: 'wood', icon: '🪵', color: '#78716c', min: 0 };
}

export function getEquippedTitle() {
  try { return localStorage.getItem(TITLE_KEY) || 'none'; } catch { return 'none'; }
}

export function setEquippedTitle(titleId) {
  try { localStorage.setItem(TITLE_KEY, titleId); } catch { /* noop */ }
}

export function loadStats() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY, achievements: {} };
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed, achievements: parsed.achievements || {} };
  } catch {
    return { ...EMPTY, achievements: {} };
  }
}

function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* modo privado */ }
}

export const ACHIEVEMENTS = [
  { id: 'first_win',  icon: '🥇', check: (s) => s.wins >= 1 },
  { id: 'winner10',   icon: '👑', check: (s) => s.wins >= 10 },
  { id: 'streak3',    icon: '🔥', check: (s) => s.streak >= 3 },
  { id: 'streak5',    icon: '⚡', check: (s) => s.streak >= 5 },
  { id: 'veteran10',  icon: '🎖️', check: (s) => s.played >= 10 },
  { id: 'veteran50',  icon: '🏅', check: (s) => s.played >= 50 },
  { id: 'teamwin',    icon: '🤝', check: (s, c) => c.won && c.teams },
  { id: 'classicwin', icon: '🎴', check: (s, c) => c.won && !c.powers },
  { id: 'powerwin',   icon: '🃏', check: (s, c) => c.won && c.powers },
  { id: 'd9win',      icon: '9️⃣', check: (s, c) => c.won && c.d9 }
];

function todayISO() {
  try { return new Date().toISOString().slice(0, 10); } catch { return ''; }
}

function didWinGame(state, myId) {
  const me = state.players?.find(p => p.id === myId);
  if (!me) return null;
  return state.teamsEnabled
    ? me.team === state.gameWinnerTeam
    : state.gameWinner === myId;
}

export function recordGame(state, myId) {
  const won = didWinGame(state, myId);
  if (won === null) return [];

  const s = loadStats();
  s.played += 1;
  if (won) {
    s.wins += 1;
    s.streak += 1;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
  } else {
    s.losses += 1;
    s.streak = 0;
  }

  const ctx = {
    won,
    teams: !!state.teamsEnabled,
    powers: !!state.powersEnabled,
    d9: state.maxPip === 9
  };

  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (!s.achievements[a.id] && a.check(s, ctx)) {
      s.achievements[a.id] = todayISO();
      unlocked.push(a.id);
    }
  }

  save(s);
  return unlocked;
}

export function recordRoundWin(state, myId) {
  const me = state.players?.find(p => p.id === myId);
  if (!me) return;
  const wonRound = state.teamsEnabled
    ? me.team === state.roundWinnerTeam
    : state.roundWinner === myId;
  if (!wonRound) return;
  const s = loadStats();
  s.roundsWon += 1;
  save(s);
}

export function winRate(s) {
  return s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0;
}
