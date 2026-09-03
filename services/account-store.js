const Database = require('better-sqlite3');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'tornbot.db');

let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS torn_accounts (
      discord_user_id TEXT PRIMARY KEY,
      torn_player_id TEXT NOT NULL,
      torn_username TEXT NOT NULL,
      encrypted_key BLOB NOT NULL,
      iv BLOB NOT NULL,
      auth_tag BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_validated_at INTEGER,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS torn_preferences (
      discord_user_id TEXT PRIMARY KEY,
      guide_enabled INTEGER DEFAULT 0,
      alert_enabled INTEGER DEFAULT 0,
      watchlist TEXT DEFAULT '[]',
      coach_preferences TEXT DEFAULT '{}'
    );
  `);

  const cols = db.prepare('PRAGMA table_info(torn_preferences)').all().map(c => c.name);
  if (!cols.includes('target_whitelist')) {
    db.exec(`ALTER TABLE torn_preferences ADD COLUMN target_whitelist TEXT DEFAULT '[]'`);
    console.log('[account-store] migrated torn_preferences: added target_whitelist');
  }

  const acctCols = db.prepare('PRAGMA table_info(torn_accounts)').all().map(c => c.name);
  if (!acctCols.includes('timezone')) {
    db.exec(`ALTER TABLE torn_accounts ADD COLUMN timezone TEXT`);
    console.log('[account-store] migrated torn_accounts: added timezone');
  }

  console.log('[account-store] initialized at', DB_PATH);
}

function getAccount(discordUserId) {
  const row = db.prepare('SELECT * FROM torn_accounts WHERE discord_user_id = ? AND status = ?').get(discordUserId, 'active');
  if (!row) return null;
  return {
    discordUserId: row.discord_user_id,
    tornPlayerId: row.torn_player_id,
    tornUsername: row.torn_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastValidatedAt: row.last_validated_at,
    status: row.status,
    timezone: row.timezone || null,
  };
}

function setTimezone(discordUserId, timezone) {
  const tz = (timezone || '').trim();
  db.prepare('UPDATE torn_accounts SET timezone = ?, updated_at = ? WHERE discord_user_id = ? AND status = ?')
    .run(tz || null, Math.floor(Date.now() / 1000), discordUserId, 'active');
  return getAccount(discordUserId);
}

function getApiKey(discordUserId) {
  const row = db.prepare('SELECT encrypted_key, iv, auth_tag FROM torn_accounts WHERE discord_user_id = ? AND status = ?').get(discordUserId, 'active');
  if (!row) return null;
  try {
    return decrypt(row.encrypted_key, row.iv, row.auth_tag);
  } catch (e) {
    console.error('[account-store] decrypt failed for', discordUserId, ':', e.message);
    return null;
  }
}

function saveAccount(discordUserId, tornPlayerId, tornUsername, apiKey) {
  const { encrypted, iv, authTag } = encrypt(apiKey);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO torn_accounts (discord_user_id, torn_player_id, torn_username, encrypted_key, iv, auth_tag, created_at, updated_at, last_validated_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    ON CONFLICT(discord_user_id) DO UPDATE SET
      torn_player_id = excluded.torn_player_id,
      torn_username = excluded.torn_username,
      encrypted_key = excluded.encrypted_key,
      iv = excluded.iv,
      auth_tag = excluded.auth_tag,
      updated_at = excluded.updated_at,
      last_validated_at = excluded.last_validated_at,
      status = 'active'
  `).run(discordUserId, tornPlayerId, tornUsername, encrypted, iv, authTag, now, now, now);
}

function removeAccount(discordUserId) {
  db.prepare('UPDATE torn_accounts SET status = ? WHERE discord_user_id = ?').run('removed', discordUserId);
}

function getPreferences(discordUserId) {
  let row = db.prepare('SELECT * FROM torn_preferences WHERE discord_user_id = ?').get(discordUserId);
  if (!row) {
    db.prepare('INSERT INTO torn_preferences (discord_user_id) VALUES (?)').run(discordUserId);
    row = db.prepare('SELECT * FROM torn_preferences WHERE discord_user_id = ?').get(discordUserId);
  }
  return {
    guideEnabled: !!row.guide_enabled,
    alertEnabled: !!row.alert_enabled,
    watchlist: JSON.parse(row.watchlist || '[]'),
    coachPreferences: JSON.parse(row.coach_preferences || '{}'),
    targetWhitelist: JSON.parse(row.target_whitelist || '[]'),
  };
}

function updatePreferences(discordUserId, updates) {
  const current = getPreferences(discordUserId);
  const merged = { ...current, ...updates };
  db.prepare(`
    INSERT INTO torn_preferences (discord_user_id, guide_enabled, alert_enabled, watchlist, coach_preferences, target_whitelist)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      guide_enabled = excluded.guide_enabled,
      alert_enabled = excluded.alert_enabled,
      watchlist = excluded.watchlist,
      coach_preferences = excluded.coach_preferences,
      target_whitelist = excluded.target_whitelist
  `).run(
    discordUserId,
    merged.guideEnabled ? 1 : 0,
    merged.alertEnabled ? 1 : 0,
    JSON.stringify(merged.watchlist),
    JSON.stringify(merged.coachPreferences),
    JSON.stringify(merged.targetWhitelist || [])
  );
}

function getAllAccounts() {
  return db.prepare('SELECT discord_user_id, torn_player_id, torn_username, status, created_at, last_validated_at, timezone FROM torn_accounts').all();
}

module.exports = {
  init,
  getAccount,
  getApiKey,
  saveAccount,
  setTimezone,
  removeAccount,
  getPreferences,
  updatePreferences,
  getAllAccounts,
};
