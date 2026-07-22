// Misiones diarias. Se miden como DELTAS sobre una instantánea de las estadísticas
// tomada al inicio del día, así no hace falta enganchar cada evento del juego:
// basta con comparar el stat actual contra el de la snapshot.
//
// type → columna de la tabla stats.
const STAT_KEY = { play: 'games_played', win: 'wins', points: 'points_scored' };

// Dos variantes por categoría; cada día se elige una de cada una (play/win/points).
const MISSION_POOL = {
  play: [
    { id: 'play2', type: 'play', target: 2, reward: 40 },
    { id: 'play4', type: 'play', target: 4, reward: 80 }
  ],
  win: [
    { id: 'win1', type: 'win', target: 1, reward: 60 },
    { id: 'win2', type: 'win', target: 2, reward: 120 }
  ],
  points: [
    { id: 'pts60',  type: 'points', target: 60,  reward: 50 },
    { id: 'pts120', type: 'points', target: 120, reward: 90 }
  ]
};

// Selección determinista por número de día: estable durante el día, varía entre días.
function missionsForDay(dayNum) {
  const n = Math.floor(dayNum);
  return [
    MISSION_POOL.play[n % 2],
    MISSION_POOL.win[(n >> 1) % 2],
    MISSION_POOL.points[(n >> 2) % 2]
  ];
}

// Progreso de una misión: delta actual − snapshot, limitado al objetivo.
function missionProgress(mission, snapshot, current) {
  const key = STAT_KEY[mission.type];
  const delta = Math.max(0, (Number(current[key]) || 0) - (Number(snapshot[key]) || 0));
  return { progress: Math.min(delta, mission.target), completed: delta >= mission.target };
}

module.exports = { STAT_KEY, MISSION_POOL, missionsForDay, missionProgress };
