import Database from "better-sqlite3";
import { getRefreshRateSeconds, seedRefreshRateHistory } from "./settings.js";

export type AppDB = Database.Database;

function buildMigrations(refreshRateSeconds: number): string {
  return `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_address TEXT UNIQUE NOT NULL,
  api_key     TEXT UNIQUE NOT NULL,
  friendly_id TEXT UNIQUE NOT NULL,
  fw_version  TEXT,
  model       TEXT,
  refresh_rate INTEGER NOT NULL DEFAULT ${refreshRateSeconds},
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

CREATE TABLE IF NOT EXISTS widget_states (
  name        TEXT PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_rate_history (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  refresh_rate_seconds INTEGER NOT NULL CHECK (refresh_rate_seconds > 0),
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
}

export function openDatabase(path: string, refreshRateSeconds = 5): AppDB {
  const db = new Database(path);
  db.exec(buildMigrations(refreshRateSeconds));
  // Additive migrations (safe to run on existing DBs)
  try { db.exec("ALTER TABLE request_logs ADD COLUMN ip TEXT;"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE devices ADD COLUMN widget_index INTEGER NOT NULL DEFAULT 0;"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE widget_states ADD COLUMN schedule_start TEXT;"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE widget_states ADD COLUMN schedule_end TEXT;"); } catch { /* already exists */ }
  seedRefreshRateHistory(db, refreshRateSeconds);
  const currentRefreshRateSeconds = getRefreshRateSeconds(db, refreshRateSeconds);
  db.prepare("UPDATE devices SET refresh_rate = ? WHERE refresh_rate != ?").run(
    currentRefreshRateSeconds,
    currentRefreshRateSeconds
  );
  return db;
}
