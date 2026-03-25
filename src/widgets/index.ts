import { writeFileSync } from "fs";
import { join } from "path";
import type { Config } from "../config.js";
import type { WidgetDefinition } from "./types.js";
import { clockWidget } from "./clock.js";
import { weatherWidget } from "./weather.js";
import { systemWidget } from "./system.js";
import { calendarWidget } from "./calendar.js";
import { analogClockWidget } from "./analog-clock.js";
import { panelWidget } from "./panel.js";
import { photosWidget } from "./photos.js";

export type { WidgetDefinition } from "./types.js";

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * All active widgets. To add a new widget:
 *   1. Create src/widgets/my-widget.ts exporting a WidgetDefinition
 *   2. Import it here and add it to this array — nothing else changes.
 */
export const WIDGETS: WidgetDefinition[] = [
  clockWidget,
  analogClockWidget,
  weatherWidget,
  systemWidget,
  calendarWidget,
  panelWidget,
  photosWidget,
];

function checkEnvVars(): void {
  for (const w of WIDGETS) {
    for (const v of w.envVars ?? []) {
      if (v.required && !process.env[v.name]) {
        console.warn(`  ${YELLOW}⚠${RESET}  widget  ${DIM}${w.name}${RESET}  missing required env var ${v.name} (${v.description})`);
      }
    }
  }
}

async function generateWidget(
  widget: WidgetDefinition,
  imageDir: string,
  config: Config
): Promise<void> {
  try {
    const buf = await widget.render(config);
    writeFileSync(join(imageDir, `widget-${widget.name}.bmp`), buf);
    console.log(`  ${CYAN}⬡${RESET}  widget  ${DIM}${widget.name}${RESET}`);
  } catch (err) {
    console.error(`  ${RED}✗${RESET}  widget  ${widget.name} failed:`, err);
  }
}

export async function startWidgets(config: Config): Promise<void> {
  checkEnvVars();

  // Generate all widgets immediately on startup
  await Promise.all(WIDGETS.map((w) => generateWidget(w, config.imageDir, config)));

  // Each widget schedules its own refresh interval
  for (const w of WIDGETS) {
    const intervalMs = w.intervalMs ?? config.widgetRefreshIntervalMs;
    setInterval(() => {
      void generateWidget(w, config.imageDir, config);
    }, intervalMs);
  }
}
