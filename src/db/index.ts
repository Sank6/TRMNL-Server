import Database from "better-sqlite3";

export type AppDB = Database.Database;

const MIGRATIONS = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_address TEXT UNIQUE NOT NULL,
  api_key     TEXT UNIQUE NOT NULL,
  friendly_id TEXT UNIQUE NOT NULL,
  fw_version  TEXT,
  model       TEXT,
  refresh_rate INTEGER NOT NULL DEFAULT 900,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT
);

CREATE TABLE IF NOT EXISTS request_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  ip          TEXT,
  headers     TEXT NOT NULL DEFAULT '{}',
  body        TEXT,
  status_code INTEGER,
  response    TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS device_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_address TEXT,
  api_key     TEXT,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDatabase(path: string): AppDB {
  const db = new Database(path);
  db.exec(MIGRATIONS);
  // Additive migrations (safe to run on existing DBs)
  try { db.exec("ALTER TABLE request_logs ADD COLUMN ip TEXT;"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE devices ADD COLUMN widget_index INTEGER NOT NULL DEFAULT 0;"); } catch { /* already exists */ }
  return db;
}
