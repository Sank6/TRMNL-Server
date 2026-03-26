import { cpus, freemem, totalmem, uptime } from "os";
import { svgToBmp, DISPLAY_WIDTH, DISPLAY_HEIGHT } from "./image-pipeline.js";
import type { Config } from "../config.js";
import type { WidgetDefinition } from "./types.js";

const W = DISPLAY_WIDTH;
const H = DISPLAY_HEIGHT;

// ── CPU sampling (works cross-platform including Windows) ───────────────────

async function cpuPercent(): Promise<number> {
  const sample = () =>
    cpus().map((c) => ({
      idle: c.times.idle,
      total: Object.values(c.times).reduce((a, b) => a + b, 0),
    }));

  const t1 = sample();
  await new Promise((r) => setTimeout(r, 400));
  const t2 = sample();

  const idle = t2.reduce((s, c, i) => s + c.idle - t1[i].idle, 0);
  const total = t2.reduce((s, c, i) => s + c.total - t1[i].total, 0);
  return total === 0 ? 0 : Math.round((1 - idle / total) * 100);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

/** SVG progress bar from (x,y) with given width/height, filled 0-100%. */
function barSvg(
  x: number,
  y: number,
  width: number,
  height: number,
  pct: number
): string {
  const fillW = Math.round((pct / 100) * width);
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="#e8e8e8"/>
    <rect x="${x}" y="${y}" width="${fillW}" height="${height}" rx="6" fill="black"/>`;
}

// ── SVG builder ─────────────────────────────────────────────────────────────

function buildSystemSvg(cpu: number, ramUsedGb: number, ramTotalGb: number, uptimeStr: string, baseUrl: string): string {
  const ramPct = Math.round((ramUsedGb / ramTotalGb) * 100);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>

  <!-- Title + URL in same header row (no footer overlap) -->
  <text x="44" y="76"
    font-family="Arial, Helvetica, sans-serif"
    font-size="56" font-weight="bold" fill="black">System Stats</text>
  <text x="${W - 44}" y="76"
    text-anchor="end"
    font-family="Arial, Helvetica, sans-serif"
    font-size="28" fill="#888">${baseUrl}</text>

  <!-- Divider -->
  <line x1="0" y1="102" x2="${W}" y2="102" stroke="black" stroke-width="1"/>

  <!-- CPU label -->
  <text x="44" y="168"
    font-family="Arial, Helvetica, sans-serif"
    font-size="40" fill="#444">CPU</text>
  <text x="${W - 44}" y="168"
    text-anchor="end"
    font-family="Arial, Helvetica, sans-serif"
    font-size="40" font-weight="bold" fill="black">${cpu}%</text>
  ${barSvg(44, 184, W - 88, 36, cpu)}

  <!-- RAM label -->
  <text x="44" y="284"
    font-family="Arial, Helvetica, sans-serif"
    font-size="40" fill="#444">Memory</text>
  <text x="${W - 44}" y="284"
    text-anchor="end"
    font-family="Arial, Helvetica, sans-serif"
    font-size="40" font-weight="bold" fill="black">${ramUsedGb.toFixed(1)} / ${ramTotalGb.toFixed(1)} GB</text>
  ${barSvg(44, 300, W - 88, 36, ramPct)}

  <!-- Divider -->
  <line x1="0" y1="366" x2="${W}" y2="366" stroke="black" stroke-width="1"/>

  <!-- Uptime — full width, no URL collision -->
  <text x="44" y="425"
    font-family="Arial, Helvetica, sans-serif"
    font-size="38" fill="#444">Uptime</text>
  <text x="210" y="425"
    font-family="Arial, Helvetica, sans-serif"
    font-size="38" font-weight="bold" fill="black">${uptimeStr}</text>
</svg>`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function renderSystemBmp(config: Config): Promise<Buffer> {
  const cpu = await cpuPercent();
  const total = totalmem();
  const free = freemem();
  const used = total - free;
  const ramTotal = total / 1024 ** 3;
  const ramUsed = used / 1024 ** 3;
  const uptimeStr = formatUptime(uptime());

  const svg = buildSystemSvg(cpu, ramUsed, ramTotal, uptimeStr, config.baseUrl);
  return svgToBmp(svg);
}

export const systemWidget: WidgetDefinition = {
  name: "system",
  render: (config) => renderSystemBmp(config),
};
