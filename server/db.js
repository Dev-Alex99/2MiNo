const { Pool } = require('pg');
const { STORE_ITEMS, getItem } = require('./storeCatalog');

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

async function recordMatchEnd({ id, roomId, variant, teamsEnabled, winnerName, winnerId, finalScores, moveLog, players }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO match_history (id, room_id, variant, teams_enabled, winner_name, winner_id, final_scores, move_log)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [id, roomId, variant || 'double_6', !!teamsEnabled, winnerName, winnerId, JSON.stringify(finalScores), JSON.stringify(moveLog)]
    );

    // Actualizar estadísticas, ELO y doblones de cada jugador humano.
    if (Array.isArray(players)) {
      for (const p of players) {
        if (!p.isBot && p.id) {
          const isWinner = p.id === winnerId || (teamsEnabled && `team_${p.team}` === winnerId);
          const isTie = winnerId === 'tie' || !winnerId;
          const eloChange = isTie ? 0 : (isWinner ? 25 : -10);
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

async function getUserProfile(userId) {
  if (!pool || !userId) return null;
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

// Comprar (si hace falta) y equipar una skin/tapete.
// El precio es AUTORITATIVO del servidor: nunca se confía en un coste enviado
// por el cliente. Un item desconocido se rechaza.
async function equipItem(userId, category, itemId, username = 'Jugador') {
  if (!pool) return { success: false, error: 'Persistencia no disponible.' };
  if (!userId) return { success: false, error: 'Jugador no identificado.' };

  const item = getItem(category, itemId);
  if (!item) return { success: false, error: 'Artículo no válido.' };

  try {
    // Garantizar que el usuario existe (crea fila con valores por defecto).
    await getOrCreateUser(userId, username);

    const userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0] || { coins: 500 };

    // ¿Ya la posee? (los gratuitos se consideran siempre en propiedad)
    const ownedCheck = await pool.query(
      'SELECT 1 FROM owned_skins WHERE user_id = $1 AND skin_id = $2',
      [userId, itemId]
    );
    const alreadyOwned = ownedCheck.rows.length > 0 || item.cost === 0;
    const actualCost = alreadyOwned ? 0 : item.cost;

    if (actualCost > 0 && (user.coins || 0) < actualCost) {
      return { success: false, error: 'Doblones insuficientes. ¡Gana más partidas!' };
    }

    // Compra nueva: descontar monedas de forma atómica (evita saldo negativo por
    // condiciones de carrera) y registrar la skin.
    if (!alreadyOwned && actualCost > 0) {
      const spend = await pool.query(
        'UPDATE users SET coins = coins - $2 WHERE id = $1 AND coins >= $2 RETURNING coins',
        [userId, actualCost]
      );
      if (spend.rows.length === 0) {
        return { success: false, error: 'Doblones insuficientes. ¡Gana más partidas!' };
      }
      await pool.query(
        'INSERT INTO owned_skins (user_id, skin_id, category) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [userId, itemId, category]
      );
    }

    // Equipar la skin en el campo correspondiente.
    const field = category === 'tile' ? 'equipped_tile_skin' : 'equipped_board_theme';
    await pool.query(`UPDATE users SET ${field} = $2 WHERE id = $1`, [userId, itemId]);

    const updated = await getUserProfile(userId);
    return { success: true, user: updated, purchased: !alreadyOwned && actualCost > 0 };
  } catch (e) {
    console.warn('[BD Error equipItem]', e.message);
    return { success: false, error: 'No se pudo completar la operación.' };
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
  getUserProfile,
  equipItem
};
