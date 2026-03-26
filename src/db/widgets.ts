import type { AppDB } from "./index.js";

export interface WidgetStateRow {
  name: string;
  enabled: number;
  updated_at: string;
}

export function listWidgetStates(db: AppDB): WidgetStateRow[] {
  return db
    .prepare("SELECT name, enabled, updated_at FROM widget_states ORDER BY name ASC")
    .all() as WidgetStateRow[];
}

export function setWidgetEnabled(
  db: AppDB,
  name: string,
  enabled: boolean
): WidgetStateRow {
  db.prepare(`
    INSERT INTO widget_states (name, enabled, updated_at)
    VALUES (@name, @enabled, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run({ name, enabled: enabled ? 1 : 0 });

  return db
    .prepare("SELECT name, enabled, updated_at FROM widget_states WHERE name = ?")
    .get(name) as WidgetStateRow;
}
