import type { AppDB } from "./index.js";

export interface RefreshRateEntry {
  id: number;
  refresh_rate_seconds: number;
  created_at: string;
}

export function seedRefreshRateHistory(db: AppDB, refreshRateSeconds: number): void {
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM refresh_rate_history")
    .get() as { n: number };

  if (n > 0) return;
  setRefreshRateSeconds(db, refreshRateSeconds);
}

export function getRefreshRateSeconds(db: AppDB, fallbackSeconds = 5): number {
  const row = db
    .prepare("SELECT refresh_rate_seconds FROM refresh_rate_history ORDER BY id DESC LIMIT 1")
    .get() as { refresh_rate_seconds: number } | undefined;

  const value = row?.refresh_rate_seconds ?? fallbackSeconds;
  return Number.isInteger(value) && value > 0 ? value : fallbackSeconds;
}

export function getRefreshRateEntry(db: AppDB, fallbackSeconds = 5): RefreshRateEntry {
  const row = db
    .prepare("SELECT id, refresh_rate_seconds, created_at FROM refresh_rate_history ORDER BY id DESC LIMIT 1")
    .get() as RefreshRateEntry | undefined;

  if (row) return row;
  const refresh_rate_seconds = getRefreshRateSeconds(db, fallbackSeconds);
  return { id: 0, refresh_rate_seconds, created_at: "" };
}

export function setRefreshRateSeconds(db: AppDB, refreshRateSeconds: number): RefreshRateEntry {
  if (!Number.isInteger(refreshRateSeconds) || refreshRateSeconds <= 0) {
    throw new Error("refresh_rate_seconds must be a positive integer");
  }

  db.prepare("INSERT INTO refresh_rate_history (refresh_rate_seconds) VALUES (?)").run(
    refreshRateSeconds
  );
  db.prepare("UPDATE devices SET refresh_rate = ? WHERE refresh_rate != ?").run(
    refreshRateSeconds,
    refreshRateSeconds
  );

  return getRefreshRateEntry(db, refreshRateSeconds);
}
