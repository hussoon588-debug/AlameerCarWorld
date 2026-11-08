const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const file = process.env.DB_FILE || './data/game.sqlite';
const resolved = path.resolve(file);
fs.mkdirSync(path.dirname(resolved), {recursive:true});
const db = new Database(resolved);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
 email TEXT UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','employee','manager','owner')),
 balance_yer INTEGER NOT NULL DEFAULT 500000 CHECK(balance_yer >= 0),
 level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, banned INTEGER NOT NULL DEFAULT 0,
 last_seen TEXT
);
CREATE TABLE IF NOT EXISTS cars(
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 category TEXT NOT NULL, price_yer INTEGER NOT NULL CHECK(price_yer >= 0),
 stock INTEGER NOT NULL DEFAULT -1, enabled INTEGER NOT NULL DEFAULT 1,
 description TEXT NOT NULL DEFAULT '',
 top_speed REAL NOT NULL DEFAULT 220, accel REAL NOT NULL DEFAULT 12,
 handling REAL NOT NULL DEFAULT 0.85, color TEXT NOT NULL DEFAULT '#1a1a2e',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS player_cars(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 car_id INTEGER NOT NULL REFERENCES cars(id), nickname TEXT NOT NULL DEFAULT '',
 acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_active INTEGER NOT NULL DEFAULT 0,
 odometer_km REAL NOT NULL DEFAULT 0, crashes INTEGER NOT NULL DEFAULT 0,
 color TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS transactions(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 type TEXT NOT NULL, amount_yer INTEGER NOT NULL, reference TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS missions(
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 description TEXT NOT NULL, reward_yer INTEGER NOT NULL CHECK(reward_yer >= 0),
 reward_xp INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
 target_value REAL NOT NULL DEFAULT 0, mission_type TEXT NOT NULL DEFAULT 'delivery'
);
CREATE TABLE IF NOT EXISTS mission_completions(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 mission_id INTEGER NOT NULL REFERENCES missions(id),
 completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 proof TEXT,
 UNIQUE(user_id, mission_id)
);
CREATE TABLE IF NOT EXISTS audit_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT NOT NULL,
 target TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS game_settings(
 key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 channel TEXT NOT NULL DEFAULT 'global', message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS voice_rooms(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, max_users INTEGER NOT NULL DEFAULT 8
);
CREATE TABLE IF NOT EXISTS telemetry(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 event TEXT NOT NULL, data TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_player_cars_user ON player_cars(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel, id DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_user ON telemetry(user_id, id DESC);
`);
module.exports = db;
