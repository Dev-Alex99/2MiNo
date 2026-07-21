const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:e5SWx125pb1z4Qj9@db.bbaedrtzhfnnpdkuwbsr.supabase.co:5432/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
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

// Funciones helper de persistencia
async function getOrCreateUser(userId, username) {
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

async function recordMatchEnd({ id, roomId, variant, teamsEnabled, winnerName, winnerId, finalScores, moveLog, players }) {
  try {
    await pool.query(
      `INSERT INTO match_history (id, room_id, variant, teams_enabled, winner_name, winner_id, final_scores, move_log)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [id, roomId, variant || 'double_6', !!teamsEnabled, winnerName, winnerId, JSON.stringify(finalScores), JSON.stringify(moveLog)]
    );

    // Actualizar estadísticas y ELO de cada jugador en la partida
    if (Array.isArray(players)) {
      for (const p of players) {
        if (!p.isBot && p.id) {
          const isWinner = p.id === winnerId || (teamsEnabled && p.team === winnerId);
          const eloChange = isWinner ? 25 : -10;
          const coinsEarned = isWinner ? 50 : 10;

          await pool.query(
            `INSERT INTO stats (user_id, games_played, wins, losses, points_scored)
             VALUES ($1, 1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET
               games_played = stats.games_played + 1,
               wins = stats.wins + $2,
               losses = stats.losses + $3,
               points_scored = stats.points_scored + $4,
               updated_at = CURRENT_TIMESTAMP`,
            [p.id, isWinner ? 1 : 0, isWinner ? 0 : 1, p.score || 0]
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

async function getGlobalLeaderboard(limit = 10) {
  try {
    const res = await pool.query(`
      SELECT u.id, u.username, u.avatar, u.elo, u.coins, s.games_played, s.wins, s.losses, s.points_scored
      FROM users u
      LEFT JOIN stats s ON u.id = s.user_id
      ORDER BY s.wins DESC, u.elo DESC
      LIMIT $1
    `, [limit]);
    return res.rows;
  } catch (e) {
    console.warn('[BD Error getGlobalLeaderboard]', e.message);
    return [];
  }
}

async function getUserProfile(userId) {
  try {
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (res.rows.length === 0) return null;
    const stats = await pool.query('SELECT * FROM stats WHERE user_id = $1', [userId]);
    const ownedRes = await pool.query('SELECT skin_id FROM owned_skins WHERE user_id = $1', [userId]);
    const ownedSkins = ownedRes.rows.map(r => r.skin_id);
    return { ...res.rows[0], stats: stats.rows[0] || {}, ownedSkins };
  } catch (e) {
    console.warn('[BD Error getUserProfile]', e.message);
    return null;
  }
}

async function equipItem(userId, category, itemId, cost = 0, username = 'Jugador') {
  try {
    let userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      await getOrCreateUser(userId, username);
      userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [userId]);
    }

    const user = userRes.rows[0] || { coins: 500 };

    // Verificar si ya la tiene
    const ownedCheck = await pool.query(
      'SELECT 1 FROM owned_skins WHERE user_id = $1 AND skin_id = $2',
      [userId, itemId]
    );
    const alreadyOwned = ownedCheck.rows.length > 0 || cost === 0;

    const actualCost = alreadyOwned ? 0 : cost;

    if (actualCost > 0 && (user.coins || 0) < actualCost) {
      return { success: false, error: 'Doblones insuficientes. ¡Gana más partidas!' };
    }

    // Si es compra nueva, registrar la skin y descontar monedas
    if (!alreadyOwned && actualCost > 0) {
      await pool.query(
        'INSERT INTO owned_skins (user_id, skin_id, category) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [userId, itemId, category]
      );
      await pool.query(
        'UPDATE users SET coins = GREATEST(0, coins - $2) WHERE id = $1',
        [userId, actualCost]
      );
    }

    // Equipar la skin
    const field = category === 'tile' ? 'equipped_tile_skin' : 'equipped_board_theme';
    await pool.query(
      `UPDATE users SET ${field} = $2 WHERE id = $1`,
      [userId, itemId]
    );

    const updated = await getUserProfile(userId);
    return { success: true, user: updated, purchased: !alreadyOwned && actualCost > 0 };
  } catch (e) {
    console.warn('[BD Error equipItem]', e.message);
    return { success: false, error: e.message };
  }
}

initDb();

module.exports = {
  pool,
  getOrCreateUser,
  recordMatchEnd,
  getGlobalLeaderboard,
  getUserProfile,
  equipItem
};
