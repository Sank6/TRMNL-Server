import type { Config } from "../config.js";

export interface EnvVarSpec {
  name: string;
  description: string;
  required: boolean;
}

export interface DashboardActionSpec {
  action: string;
  label: string;
}

export interface WidgetDashboardSpec {
  actions?: DashboardActionSpec[];
  /** Refresh the dashboard preview this many times faster than config.refreshRateMs. */
  previewRefreshMultiplier?: number;
  /** How the dashboard should refresh the widget preview. */
  previewRefreshMode?: "reload" | "regenerate";
}

export interface WidgetDefinition {
  /** Used for the output filename: widget-{name}.bmp */
  name: string;
  /** Optional per-widget refresh interval; defaults to config.refreshRateMs */
  intervalMs?: number;
  /** Render the widget to a 1-bit BMP buffer */
  render: (config: Config) => Promise<Buffer>;
  /**
   * Env vars this widget reads. Declare these so startup can warn about
   * missing required credentials and the dashboard can surface them.
   * Widgets read their own env vars directly via process.env — no changes
   * to Config are needed when adding an API-backed widget.
   */
  envVars?: EnvVarSpec[];
  /** Dashboard-only controls registered by the widget. */
  dashboard?: WidgetDashboardSpec;
}
