const { Pool } = require('pg');
const { STORE_ITEMS, getItem } = require('./storeCatalog');
const { missionsForDay, missionProgress } = require('./dailyMissions');

// Fecha (UTC) como 'YYYY-MM-DD' y número de día para elegir misiones.
function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() { return new Date(Date.now() - 86400000).toISOString().slice(0, 10); }
function dayNumber() { return Math.floor(Date.now() / 86400000); }

// La cadena de conexión SIEMPRE viene de la variable de entorno DATABASE_URL.
// Nunca se hardcodea una credencial en el código (quedaría expuesta en git).
// Si falta, el juego funciona igual en modo "sin persistencia" (degradado).
const DATABASE_URL = process.env.DATABASE_URL || '';
const DB_ENABLED = !!DATABASE_URL;

const pool = DB_ENABLED
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      // Límites conservadores pensados para Render 512 MB + Supabase.
      max: Number(process.env.DB_POOL_MAX) || 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

if (!DB_ENABLED) {
  console.warn('[BD] DATABASE_URL no está configurada. Persistencia (usuarios, tienda, ranking) DESACTIVADA.');
}

if (pool) {
  // Un error en un cliente inactivo del pool no debe tumbar el proceso.
  pool.on('error', (err) => console.warn('[BD] Error de cliente inactivo:', err.message));
}

async function initDb() {
  if (!pool) return;
  try {
    const client = await pool.connect();
    console.log('[Supabase BD] Conexión establecida correctamente');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(64) NOT NULL DEFAULT 'Jugador',
        avatar VARCHAR(255) DEFAULT '',
        coins INT DEFAULT 500,
        elo INT DEFAULT 1200,
        equipped_tile_skin VARCHAR(64) DEFAULT 'classic',
        equipped_board_theme VARCHAR(64) DEFAULT 'emerald',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stats (
        user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        games_played INT DEFAULT 0,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        ties INT DEFAULT 0,
        points_scored INT DEFAULT 0,
        trancas_won INT DEFAULT 0,
        powers_used INT DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS match_history (
        id VARCHAR(64) PRIMARY KEY,
        room_id VARCHAR(64) NOT NULL,
        variant VARCHAR(32) DEFAULT 'double_6',
        teams_enabled BOOLEAN DEFAULT FALSE,
        winner_name VARCHAR(64),
        winner_id VARCHAR(64),
        final_scores JSONB,
        move_log JSONB,
        played_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS owned_skins (
        user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
        skin_id VARCHAR(64) NOT NULL,
        category VARCHAR(16) NOT NULL DEFAULT 'tile',
        purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, skin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_users_elo ON users (elo DESC);

      -- Misiones diarias y racha de login (columnas añadidas de forma incremental)
      ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INT DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login VARCHAR(10);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_date VARCHAR(10);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_snapshot JSONB;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_missions JSONB;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_claimed JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE stats ADD COLUMN IF NOT EXISTS tournaments_won INT DEFAULT 0;
      ALTER TABLE match_history ADD COLUMN IF NOT EXISTS ranked BOOLEAN DEFAULT FALSE;

      -- Amigos: código para agregar + relación de amistad
      ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code VARCHAR(8);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_friend_code ON users (friend_code) WHERE friend_code IS NOT NULL;

      CREATE TABLE IF NOT EXISTS friendships (
        a_id VARCHAR(64) NOT NULL,
        b_id VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (a_id, b_id)
      );
    `);

    // Eliminar la constraint UNIQUE del username si existía de versiones anteriores
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `).catch(() => {});

    client.release();
    console.log('[Supabase BD] Tablas (users, stats, match_history, owned_skins) listas');
  } catch (err) {
    console.warn('[Supabase BD] Aviso:', err.message);
  }
}

// ¿Es un nombre real elegido por el jugador o un marcador de posición?
function isRealName(username) {
  return !!username && username !== 'Jugador' && !/^Jugador_/.test(username);
}

// Funciones helper de persistencia
async function getOrCreateUser(userId, username) {
  if (!pool || !userId) return null;
  try {
    let res = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (res.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username',
        [userId, username || `Jugador_${userId.substring(0, 4)}`]
      );
      await pool.query(
        'INSERT INTO stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [userId]
      );
      res = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    } else if (isRealName(username) && res.rows[0].username !== username) {
      // Mantener el nombre para mostrar sincronizado si el jugador lo cambió.
      await pool.query('UPDATE users SET username = $2 WHERE id = $1', [userId, username]);
      res.rows[0].username = username;
    }
    const statsRes = await pool.query('SELECT * FROM stats WHERE user_id = $1', [userId]);
    const ownedRes = await pool.query('SELECT skin_id FROM owned_skins WHERE user_id = $1', [userId]);
    const ownedSkins = ownedRes.rows.map(r => r.skin_id);
    return { user: res.rows[0], stats: statsRes.rows[0] || {}, ownedSkins };
  } catch (e) {
    console.warn('[BD Error getOrCreateUser]', e.message);
    return null;
  }
}

async function recordMatchEnd({ id, roomId, variant, teamsEnabled, winnerName, winnerId, finalScores, moveLog, players, applyElo = false }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO match_history (id, room_id, variant, teams_enabled, winner_name, winner_id, final_scores, move_log, ranked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [id, roomId, variant || 'double_6', !!teamsEnabled, winnerName, winnerId, JSON.stringify(finalScores), JSON.stringify(moveLog), !!applyElo]
    );

    // Actualizar estadísticas, ELO y doblones de cada jugador humano.
    if (Array.isArray(players)) {
      for (const p of players) {
        if (!p.isBot && p.id) {
          const isWinner = p.id === winnerId || (teamsEnabled && `team_${p.team}` === winnerId);
          const isTie = winnerId === 'tie' || !winnerId;
          // ELO solo en clasificatoria (applyElo). Los doblones y estadísticas
          // se otorgan siempre (alimentan tienda y misiones).
          const eloChange = (applyElo && !isTie) ? (isWinner ? 25 : -10) : 0;
          const coinsEarned = isTie ? 25 : (isWinner ? 50 : 10);

          // Asegurar que la fila del usuario existe antes de acreditar recompensas.
          await pool.query(
            `INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
            [p.id, isRealName(p.name) ? p.name : `Jugador_${String(p.id).substring(0, 4)}`]
          );

          await pool.query(
            `INSERT INTO stats (user_id, games_played, wins, losses, ties, points_scored)
             VALUES ($1, 1, $2, $3, $4, $5)
             ON CONFLICT (user_id) DO UPDATE SET
               games_played = stats.games_played + 1,
               wins = stats.wins + $2,
               losses = stats.losses + $3,
               ties = stats.ties + $4,
               points_scored = stats.points_scored + $5,
               updated_at = CURRENT_TIMESTAMP`,
            [p.id, isWinner ? 1 : 0, (!isWinner && !isTie) ? 1 : 0, isTie ? 1 : 0, p.score || 0]
          );

          await pool.query(
            `UPDATE users SET
               elo = GREATEST(1000, elo + $2),
               coins = coins + $3
             WHERE id = $1`,
            [p.id, eloChange, coinsEarned]
          );
        }
      }
    }
    console.log(`[Supabase BD] Partida ${id} guardada, ELO y estadísticas actualizados.`);
  } catch (e) {
    console.warn('[BD Error recordMatchEnd]', e.message);
  }
}

async function getGlobalLeaderboard(limit = 15) {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT u.id, u.username, u.avatar, u.elo, u.coins,
             s.games_played, s.wins, s.losses, s.ties, s.points_scored
      FROM users u
      JOIN stats s ON u.id = s.user_id
      WHERE s.games_played > 0
      ORDER BY u.elo DESC, s.wins DESC
      LIMIT $1
    `, [limit]);
    return res.rows;
  } catch (e) {
    console.warn('[BD Error getGlobalLeaderboard]', e.message);
    return [];
  }
}

// Ranking semanal: victorias individuales en match_history desde el inicio de
// la semana. Las victorias por parejas (winner_id 'team_x') no unen con users
// y quedan fuera; es un ranking de rendimiento individual reciente.
async function getWeeklyLeaderboard(limit = 15) {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT u.id, u.username, u.elo, COUNT(*)::int AS wins
      FROM match_history mh
      JOIN users u ON u.id = mh.winner_id
      WHERE mh.played_at >= date_trunc('week', CURRENT_TIMESTAMP) AND mh.ranked = TRUE
      GROUP BY u.id, u.username, u.elo
      ORDER BY wins DESC, u.elo DESC
      LIMIT $1
    `, [limit]);
    return res.rows;
  } catch (e) {
    console.warn('[BD Error getWeeklyLeaderboard]', e.message);
    return [];
  }
}

async function getUserProfile(userId) {
  if (!pool || !userId) return null;
  try {
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (res.rows.length === 0) return null;
    const user = res.rows[0];
    if (!user.friend_code) {
      const code = await ensureFriendCode(userId);
      if (code) user.friend_code = code;
    }
    const stats = await pool.query('SELECT * FROM stats WHERE user_id = $1', [userId]);
    const ownedRes = await pool.query('SELECT skin_id FROM owned_skins WHERE user_id = $1', [userId]);
    const ownedSkins = ownedRes.rows.map(r => r.skin_id);
    return { ...user, stats: stats.rows[0] || {}, ownedSkins };
  } catch (e) {
    console.warn('[BD Error getUserProfile]', e.message);
    return null;
  }
}

// ─── Amigos ───
function genFriendCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos (0/O, 1/I)
  let code = '';
  for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

async function ensureFriendCode(userId) {
  if (!pool || !userId) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genFriendCode();
    try {
      const r = await pool.query(
        'UPDATE users SET friend_code = $2 WHERE id = $1 AND friend_code IS NULL RETURNING friend_code',
        [userId, code]
      );
      if (r.rows.length) return r.rows[0].friend_code;
      const ex = await pool.query('SELECT friend_code FROM users WHERE id = $1', [userId]);
      return ex.rows[0] ? ex.rows[0].friend_code : null;
    } catch (e) {
      if (!/unique|duplicate/i.test(e.message)) { console.warn('[BD ensureFriendCode]', e.message); return null; }
      // colisión de código → reintentar con otro
    }
  }
  return null;
}

async function getUserByFriendCode(code) {
  if (!pool || !code) return null;
  try {
    const r = await pool.query('SELECT id, username FROM users WHERE friend_code = $1', [String(code).trim().toUpperCase()]);
    return r.rows[0] || null;
  } catch (e) { console.warn('[BD getUserByFriendCode]', e.message); return null; }
}

async function sendFriendRequest(fromId, code) {
  if (!pool || !fromId) return { success: false, error: 'friend.err.generic' };
  try {
    const target = await getUserByFriendCode(code);
    if (!target) return { success: false, error: 'friend.err.notFound' };
    if (target.id === fromId) return { success: false, error: 'friend.err.self' };

    const ex = await pool.query(
      'SELECT a_id, b_id, status FROM friendships WHERE (a_id = $1 AND b_id = $2) OR (a_id = $2 AND b_id = $1)',
      [fromId, target.id]
    );
    if (ex.rows.length) {
      const row = ex.rows[0];
      if (row.status === 'accepted') return { success: false, error: 'friend.err.already' };
      if (row.a_id === target.id && row.b_id === fromId) {
        // El objetivo ya me había pedido amistad → aceptar directamente.
        await pool.query("UPDATE friendships SET status = 'accepted' WHERE a_id = $1 AND b_id = $2", [target.id, fromId]);
        return { success: true, accepted: true, target };
      }
      return { success: false, error: 'friend.err.pending' };
    }
    await pool.query("INSERT INTO friendships (a_id, b_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING", [fromId, target.id]);
    return { success: true, accepted: false, target };
  } catch (e) { console.warn('[BD sendFriendRequest]', e.message); return { success: false, error: 'friend.err.generic' }; }
}

async function respondFriendRequest(userId, otherId, accept) {
  if (!pool || !userId || !otherId) return { success: false };
  try {
    if (accept) {
      const r = await pool.query(
        "UPDATE friendships SET status = 'accepted' WHERE a_id = $1 AND b_id = $2 AND status = 'pending'",
        [otherId, userId]
      );
      return { success: r.rowCount > 0, otherId };
    }
    await pool.query("DELETE FROM friendships WHERE a_id = $1 AND b_id = $2 AND status = 'pending'", [otherId, userId]);
    return { success: true, otherId };
  } catch (e) { console.warn('[BD respondFriendRequest]', e.message); return { success: false }; }
}

async function getFriends(userId) {
  if (!pool || !userId) return [];
  try {
    const r = await pool.query(`
      SELECT u.id, u.username, u.elo
      FROM friendships f
      JOIN users u ON u.id = (CASE WHEN f.a_id = $1 THEN f.b_id ELSE f.a_id END)
      WHERE (f.a_id = $1 OR f.b_id = $1) AND f.status = 'accepted'
      ORDER BY u.username`, [userId]);
    return r.rows;
  } catch (e) { console.warn('[BD getFriends]', e.message); return []; }
}

async function getFriendRequests(userId) {
  if (!pool || !userId) return [];
  try {
    const r = await pool.query(`
      SELECT u.id, u.username, u.elo
      FROM friendships f
      JOIN users u ON u.id = f.a_id
      WHERE f.b_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC`, [userId]);
    return r.rows;
  } catch (e) { console.warn('[BD getFriendRequests]', e.message); return []; }
}

// Historial de partidas de un jugador (ligero: sin move_log, para la lista).
async function getUserMatchHistory(userId, limit = 12) {
  if (!pool || !userId) return [];
  try {
    const res = await pool.query(
      `SELECT id, variant, teams_enabled, winner_name, winner_id, final_scores, played_at
       FROM match_history
       WHERE final_scores @> $1::jsonb
       ORDER BY played_at DESC
       LIMIT $2`,
      [JSON.stringify([{ id: userId }]), limit]
    );
    return res.rows;
  } catch (e) {
    console.warn('[BD Error getUserMatchHistory]', e.message);
    return [];
  }
}

// Datos completos de una partida (incluye move_log) para reproducirla.
async function getMatchReplay(matchId) {
  if (!pool || !matchId) return null;
  try {
    const res = await pool.query('SELECT * FROM match_history WHERE id = $1', [matchId]);
    return res.rows[0] || null;
  } catch (e) {
    console.warn('[BD Error getMatchReplay]', e.message);
    return null;
  }
}

// Renueva las misiones del día y la racha de login si es un día nuevo.
// Devuelve { rolled, loginReward, streak } (loginReward solo el primer login del día).
async function rollDaily(userId) {
  if (!pool || !userId) return { rolled: false };
  try {
    const uRes = await pool.query(
      'SELECT daily_date, last_login, login_streak FROM users WHERE id = $1', [userId]
    );
    if (uRes.rows.length === 0) return { rolled: false };
    const u = uRes.rows[0];
    const today = todayStr();
    if (u.daily_date === today) return { rolled: false };

    const sRes = await pool.query(
      'SELECT games_played, wins, points_scored FROM stats WHERE user_id = $1', [userId]
    );
    const snap = sRes.rows[0] || { games_played: 0, wins: 0, points_scored: 0 };

    // Racha: +1 si el último login fue ayer; si no, se reinicia a 1.
    let streak = 1;
    if (u.last_login === yesterdayStr()) streak = (u.login_streak || 0) + 1;
    const loginReward = Math.min(streak, 7) * 10;

    const missions = missionsForDay(dayNumber());

    // Atómico: el guard `daily_date IS DISTINCT FROM $2` hace que solo la primera
    // de dos pestañas concurrentes renueve y cobre la recompensa de login.
    const upd = await pool.query(
      `UPDATE users SET
         daily_date = $2, daily_snapshot = $3, daily_missions = $4, daily_claimed = '[]'::jsonb,
         login_streak = $5, last_login = $2, coins = coins + $6
       WHERE id = $1 AND daily_date IS DISTINCT FROM $2
       RETURNING id`,
      [userId, today, JSON.stringify(snap), JSON.stringify(missions), streak, loginReward]
    );
    if (upd.rows.length === 0) return { rolled: false }; // otra sesión ya renovó hoy
    return { rolled: true, loginReward, streak };
  } catch (e) {
    console.warn('[BD rollDaily]', e.message);
    return { rolled: false };
  }
}

// Estado de misiones del día: cada misión con su progreso/completada/reclamada, + racha.
async function getDailyState(userId) {
  if (!pool || !userId) return null;
  try {
    const uRes = await pool.query(
      'SELECT daily_snapshot, daily_missions, daily_claimed, login_streak FROM users WHERE id = $1', [userId]
    );
    if (uRes.rows.length === 0) return null;
    const u = uRes.rows[0];
    const missions = Array.isArray(u.daily_missions) ? u.daily_missions : [];
    const snap = u.daily_snapshot || {};
    const claimed = Array.isArray(u.daily_claimed) ? u.daily_claimed : [];

    const sRes = await pool.query(
      'SELECT games_played, wins, points_scored FROM stats WHERE user_id = $1', [userId]
    );
    const cur = sRes.rows[0] || {};

    const list = missions.map(m => {
      const { progress, completed } = missionProgress(m, snap, cur);
      return { ...m, progress, completed, claimed: claimed.includes(m.id) };
    });
    return { streak: u.login_streak || 0, missions: list };
  } catch (e) {
    console.warn('[BD getDailyState]', e.message);
    return null;
  }
}

// Reclama la recompensa de una misión completada (atómico: sin doble cobro).
async function claimMission(userId, missionId) {
  if (!pool || !userId || !missionId) return { success: false, error: 'Datos inválidos.' };
  try {
    const state = await getDailyState(userId);
    if (!state) return { success: false, error: 'Sin misiones activas.' };
    const m = state.missions.find(x => x.id === missionId);
    if (!m) return { success: false, error: 'Misión no válida.' };
    if (!m.completed) return { success: false, error: 'Misión no completada.' };
    if (m.claimed) return { success: false, error: 'Recompensa ya reclamada.' };

    const guard = JSON.stringify([missionId]);
    const upd = await pool.query(
      `UPDATE users SET daily_claimed = daily_claimed || $2::jsonb, coins = coins + $3
       WHERE id = $1 AND NOT (daily_claimed @> $2::jsonb)
       RETURNING coins`,
      [userId, guard, m.reward]
    );
    if (upd.rows.length === 0) return { success: false, error: 'Recompensa ya reclamada.' };
    return { success: true, reward: m.reward, coins: upd.rows[0].coins, missionId };
  } catch (e) {
    console.warn('[BD claimMission]', e.message);
    return { success: false, error: 'No se pudo reclamar.' };
  }
}

// Premio de torneo: acredita doblones. Solo el campeón incrementa el contador
// de torneos ganados (el subcampeón recibe monedas pero no cuenta como victoria).
async function awardTournamentPrize(userId, amount, { won = true } = {}) {
  if (!pool || !userId || !amount) return;
  try {
    await pool.query(
      `INSERT INTO users (id, username) VALUES ($1, 'Jugador') ON CONFLICT (id) DO NOTHING`, [userId]
    );
    await pool.query('UPDATE users SET coins = coins + $2 WHERE id = $1', [userId, amount]);
    if (won) {
      await pool.query(
        `INSERT INTO stats (user_id, tournaments_won) VALUES ($1, 1)
         ON CONFLICT (user_id) DO UPDATE SET tournaments_won = stats.tournaments_won + 1`,
        [userId]
      );
    }
    console.log(`[Supabase BD] Premio de torneo (${amount}, ${won ? 'campeón' : 'subcampeón'}) para ${userId}.`);
  } catch (e) {
    console.warn('[BD Error awardTournamentPrize]', e.message);
  }
}

// Comprar (si hace falta) y equipar una skin/tapete.
// El precio es AUTORITATIVO del servidor: nunca se confía en un coste enviado
// por el cliente. Un item desconocido se rechaza.
async function equipItem(userId, category, itemId, username = 'Jugador') {
  if (!pool) return { success: false, error: 'store.errorMsg' };
  if (!userId) return { success: false, error: 'store.errorMsg' };

  const item = getItem(category, itemId);
  if (!item) return { success: false, error: 'store.err.invalid' };

  try {
    // Garantizar que el usuario existe (crea fila con valores por defecto).
    await getOrCreateUser(userId, username);

    const userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0] || { coins: 500 };

    const ownedCheck = await pool.query(
      'SELECT 1 FROM owned_skins WHERE user_id = $1 AND skin_id = $2',
      [userId, itemId]
    );
    const alreadyOwned = ownedCheck.rows.length > 0 || item.cost === 0;
    const actualCost = alreadyOwned ? 0 : item.cost;

    if (actualCost > 0 && (user.coins || 0) < actualCost) {
      return { success: false, error: 'store.insufficient' };
    }

    let purchased = false;
    // Compra nueva y ATÓMICA: registrar la propiedad primero (ON CONFLICT hace
    // que solo una petición concurrente lo consiga) y cobrar únicamente a quien
    // la registró; así nunca se cobra dos veces por la misma skin.
    if (!alreadyOwned && actualCost > 0) {
      const ins = await pool.query(
        'INSERT INTO owned_skins (user_id, skin_id, category) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING skin_id',
        [userId, itemId, category]
      );
      if (ins.rows.length) {
        const spend = await pool.query(
          'UPDATE users SET coins = coins - $2 WHERE id = $1 AND coins >= $2 RETURNING coins',
          [userId, actualCost]
        );
        if (spend.rows.length === 0) {
          // Saldo insuficiente (carrera) → revertir la propiedad recién creada.
          await pool.query('DELETE FROM owned_skins WHERE user_id = $1 AND skin_id = $2', [userId, itemId]);
          return { success: false, error: 'store.insufficient' };
        }
        purchased = true;
      }
    }

    // Equipar la skin en el campo correspondiente.
    const field = category === 'tile' ? 'equipped_tile_skin' : 'equipped_board_theme';
    await pool.query(`UPDATE users SET ${field} = $2 WHERE id = $1`, [userId, itemId]);

    const updated = await getUserProfile(userId);
    return { success: true, user: updated, purchased };
  } catch (e) {
    console.warn('[BD Error equipItem]', e.message);
    return { success: false, error: 'store.errorMsg' };
  }
}

initDb();

module.exports = {
  pool,
  dbEnabled: DB_ENABLED,
  STORE_ITEMS,
  getOrCreateUser,
  recordMatchEnd,
  getGlobalLeaderboard,
  getWeeklyLeaderboard,
  getUserProfile,
  getUserMatchHistory,
  getMatchReplay,
  rollDaily,
  getDailyState,
  claimMission,
  awardTournamentPrize,
  ensureFriendCode,
  getUserByFriendCode,
  sendFriendRequest,
  respondFriendRequest,
  getFriends,
  getFriendRequests,
  equipItem
};
