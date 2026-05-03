import type { AppDB } from "./index.js";

export interface WidgetStateRow {
  name: string;
  enabled: number;
  updated_at: string;
  schedule_start: string | null;
  schedule_end: string | null;
}

export function listWidgetStates(db: AppDB): WidgetStateRow[] {
  return db
    .prepare("SELECT name, enabled, updated_at, schedule_start, schedule_end FROM widget_states ORDER BY name ASC")
    .all() as WidgetStateRow[];
}

export function setWidgetEnabled(db: AppDB, name: string, enabled: boolean): WidgetStateRow {
  db.prepare(`
    INSERT INTO widget_states (name, enabled, updated_at)
    VALUES (@name, @enabled, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run({ name, enabled: enabled ? 1 : 0 });

  return db
    .prepare("SELECT name, enabled, updated_at, schedule_start, schedule_end FROM widget_states WHERE name = ?")
    .get(name) as WidgetStateRow;
}

export function setWidgetSchedule(
  db: AppDB,
  name: string,
  scheduleStart: string | null,
  scheduleEnd: string | null
): WidgetStateRow {
  db.prepare(`
    INSERT INTO widget_states (name, enabled, schedule_start, schedule_end, updated_at)
    VALUES (@name, 1, @scheduleStart, @scheduleEnd, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET
      schedule_start = excluded.schedule_start,
      schedule_end   = excluded.schedule_end,
      updated_at     = datetime('now')
  `).run({ name, scheduleStart, scheduleEnd });

  return db
    .prepare("SELECT name, enabled, updated_at, schedule_start, schedule_end FROM widget_states WHERE name = ?")
    .get(name) as WidgetStateRow;
}

/** Returns true if the widget should be shown right now based on its enabled flag and schedule. */
export function isWidgetActiveNow(row: WidgetStateRow): boolean {
  if (row.enabled !== 1) return false;
  if (!row.schedule_start || !row.schedule_end) return true;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH = 0, startM = 0] = row.schedule_start.split(":").map(Number);
  const [endH = 0, endM = 0] = row.schedule_end.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same-day window, e.g. 06:00–10:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight window, e.g. 22:00–06:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
