// Estadísticas y logros del jugador, guardados localmente (por navegador).
// Cero coste de servidor: encaja con el modelo anónimo del juego. No sincroniza
// entre dispositivos (esa sería una Fase 2 con cuentas + base de datos).

const KEY = 'domino_stats';

const EMPTY = {
  played: 0,
  wins: 0,
  losses: 0,
  streak: 0,
  bestStreak: 0,
  roundsWon: 0,
  achievements: {} // id -> fecha ISO de desbloqueo
};

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

// Orden en que se muestran en el perfil. `check(stats, ctx)` se evalúa tras
// actualizar el contador de la partida; ctx = { won, teams, powers, d9 }.
// El nombre y la descripción de cada logro viven en el diccionario i18n
// como ach.<id>.n / ach.<id>.d
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

// ¿Ganó `myId` esta partida? Sirve tanto para individual como para parejas.
function didWinGame(state, myId) {
  const me = state.players?.find(p => p.id === myId);
  if (!me) return null;
  return state.teamsEnabled
    ? me.team === state.gameWinnerTeam
    : state.gameWinner === myId;
}

// Registra el fin de una partida y comprueba logros.
// Devuelve los ids de los logros recién desbloqueados (para avisar al jugador).
export function recordGame(state, myId) {
  const won = didWinGame(state, myId);
  if (won === null) return []; // no estábamos en la partida

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

// Registra que ganaste una ronda (en partidas a varias rondas).
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
