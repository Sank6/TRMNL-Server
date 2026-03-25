import type { Config } from "../config.js";

export interface EnvVarSpec {
  name: string;
  description: string;
  required: boolean;
}

export interface WidgetDefinition {
  /** Used for the output filename: widget-{name}.bmp */
  name: string;
  /** Optional per-widget refresh interval; defaults to config.widgetRefreshIntervalMs */
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
}
