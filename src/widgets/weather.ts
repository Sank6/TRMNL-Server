import sharp from "sharp";
import { svgToBmp, DISPLAY_WIDTH, DISPLAY_HEIGHT, escapeXml } from "./image-pipeline.js";
import { floydSteinberg } from "./dither.js";
import type { Config } from "../config.js";
import type { WidgetDefinition } from "./types.js";

const W = DISPLAY_WIDTH;
const H = DISPLAY_HEIGHT;

// ── Types ────────────────────────────────────────────────────────────────────

interface HourlyEntry {
  hour: string;
  temperature: number;
  precipitation: number;
  precipProbability: number | null;
  weatherCode: number;
}

interface WeatherData {
  temperature: number;
  weatherCode: number;
  windSpeedMph: number;
  humidity: number;
  hourly: HourlyEntry[];
}

interface PollenData {
  treePollen: number | null;
  grassPollen: number | null;
  uvIndex: number | null;
}

// ── WMO → description ────────────────────────────────────────────────────────

const WMO_DESC: Record<number, string> = {
  0: "Clear Sky", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
  45: "Fog", 48: "Icy Fog",
  51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
  61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
  71: "Light Snow", 73: "Snow", 75: "Heavy Snow", 77: "Snow Grains",
  80: "Rain Showers", 81: "Rain Showers", 82: "Heavy Showers",
  85: "Snow Showers", 86: "Heavy Snow Showers",
  95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
};

function weatherDescription(code: number): string {
  return WMO_DESC[code] ?? "Unknown";
}

// ── WMO → external SVG icon ─────────────────────────────────────────────────

function getIconName(code: number, isDay: boolean): string {
  if (code === 0 || code === 1) return isDay ? "wi-day-sunny" : "wi-night-clear";
  if (code === 2) return isDay ? "wi-day-cloudy" : "wi-night-alt-cloudy";
  if (code === 3) return "wi-cloudy";
  if (code === 45 || code === 48) return "wi-fog";
  if (code >= 51 && code <= 55) return isDay ? "wi-day-sprinkle" : "wi-night-alt-sprinkle";
  if (code >= 56 && code <= 67) return isDay ? "wi-day-rain" : "wi-night-alt-rain";
  if (code >= 71 && code <= 77) return isDay ? "wi-day-snow" : "wi-night-alt-snow";
  if (code >= 80 && code <= 82) return isDay ? "wi-day-showers" : "wi-night-alt-showers";
  if (code >= 85 && code <= 86) return isDay ? "wi-day-snow" : "wi-night-alt-snow";
  if (code >= 95) return isDay ? "wi-day-thunderstorm" : "wi-night-alt-thunderstorm";
  return isDay ? "wi-day-sunny" : "wi-night-clear";
}

function getIconUrl(code: number, isDay: boolean): string {
  const icon = getIconName(code, isDay);
  return `https://raw.githubusercontent.com/erikflowers/weather-icons/master/svg/${icon}.svg`;
}

// ── Icon fetching + dithering ────────────────────────────────────────────────

const iconCache = new Map<string, Buffer>();

async function fetchDitheredIcon(
  code: number,
  size: number,
  isDay: boolean
): Promise<Buffer | null> {
  const key = `${code}-${size}-${isDay ? "d" : "n"}`;
  if (iconCache.has(key)) return iconCache.get(key)!;

  try {
    const url = getIconUrl(code, isDay);
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = Buffer.from(await res.arrayBuffer());

    const { data } = await sharp(raw)
      .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const dithered = floydSteinberg(data as unknown as Buffer, size, size);

    const png = await sharp(dithered, { raw: { width: size, height: size, channels: 1 } })
      .png()
      .toBuffer();

    iconCache.set(key, png);
    return png;
  } catch {
    return null;
  }
}

// ── Fallback SVG icons (no checker fills — clean 1-bit lines only) ────────────

function fallbackIconSvg(code: number): string {
  const cloud = `<path d="M -90,25 Q -90,-25 -50,-25 Q -44,-68 5,-68 Q 56,-68 62,-25 Q 92,-25 92,16 Q 92,52 52,52 L -60,52 Q -92,52 -92,25 Z"
    fill="white" stroke="black" stroke-width="11" stroke-linejoin="round"/>`;

  const sun = `
    <circle r="56" fill="none" stroke="black" stroke-width="11"/>
    <line x1="0" y1="-84" x2="0" y2="-68" stroke="black" stroke-width="11" stroke-linecap="round"/>
    <line x1="84" y1="0" x2="68" y2="0" stroke="black" stroke-width="11" stroke-linecap="round"/>
    <line x1="0" y1="84" x2="0" y2="68" stroke="black" stroke-width="11" stroke-linecap="round"/>
    <line x1="-84" y1="0" x2="-68" y2="0" stroke="black" stroke-width="11" stroke-linecap="round"/>
    <line x1="59" y1="-59" x2="48" y2="-48" stroke="black" stroke-width="11" stroke-linecap="round"/>
    <line x1="59" y1="59" x2="48" y2="48" stroke="black" stroke-width="11" stroke-linecap="round"/>
    <line x1="-59" y1="59" x2="-48" y2="48" stroke="black" stroke-width="11" stroke-linecap="round"/>
    <line x1="-59" y1="-59" x2="-48" y2="-48" stroke="black" stroke-width="11" stroke-linecap="round"/>`;

  const partlyCloudy = `
    <circle cx="36" cy="-48" r="42" fill="none" stroke="black" stroke-width="9"/>
    <line x1="36" y1="-100" x2="36" y2="-87" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="36" y1="4" x2="36" y2="-9" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="88" y1="-48" x2="75" y2="-48" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="-16" y1="-48" x2="-3" y2="-48" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <path d="M -90,25 Q -90,-25 -50,-25 Q -44,-68 5,-68 Q 56,-68 62,-25 Q 92,-25 92,16 Q 92,52 52,52 L -60,52 Q -92,52 -92,25 Z"
      fill="white" stroke="black" stroke-width="11" stroke-linejoin="round"/>`;

  const rain = `
    <line x1="-48" y1="68" x2="-60" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="0" y1="68" x2="-12" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="48" y1="68" x2="36" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>`;

  const snow = `
    <line x1="-48" y1="70" x2="-48" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-64" y1="87" x2="-32" y2="87" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="0" y1="70" x2="0" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-16" y1="87" x2="16" y2="87" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="48" y1="70" x2="48" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="32" y1="87" x2="64" y2="87" stroke="black" stroke-width="9" stroke-linecap="round"/>`;

  const lightning = `
    <polyline points="14,60 -18,106 10,106 -14,148"
      fill="none" stroke="black" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;

  const fog = `
    <line x1="-92" y1="-30" x2="92" y2="-30" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-72" y1="0" x2="72" y2="0" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-92" y1="30" x2="92" y2="30" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-72" y1="60" x2="72" y2="60" stroke="black" stroke-width="9" stroke-linecap="round"/>`;

  if (code === 0 || code === 1) return sun;
  if (code === 2) return partlyCloudy;
  if (code === 3) return cloud;
  if (code === 45 || code === 48) return fog;
  if (code >= 51 && code <= 67) return `${cloud}${rain}`;
  if (code >= 71 && code <= 77) return `${cloud}${snow}`;
  if (code >= 80 && code <= 82) return `${cloud}${rain}`;
  if (code >= 85 && code <= 86) return `${cloud}${snow}`;
  if (code >= 95) return `${cloud}${lightning}`;
  return cloud;
}

// ── Weather API ──────────────────────────────────────────────────────────────

let cachedWeather: WeatherData | null = null;
let cachedPollen: PollenData | null = null;

async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&hourly=temperature_2m,precipitation,weather_code,precipitation_probability` +
    `&temperature_unit=celsius&wind_speed_unit=mph` +
    `&timeformat=unixtime&forecast_days=2`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);

  const json = await res.json() as {
    current: {
      temperature_2m: number;
      weather_code: number;
      wind_speed_10m: number;
      relative_humidity_2m: number;
    };
    hourly: {
      time: number[];
      temperature_2m: number[];
      precipitation: number[];
      weather_code: number[];
      precipitation_probability?: number[];
    };
  };

  const c = json.current;
  const currentHourMs = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const times = json.hourly.time;
  let startIdx = times.findIndex((t) => t * 1000 >= currentHourMs);
  if (startIdx < 0) startIdx = 0;

  const hourly: HourlyEntry[] = [];
  for (let i = 0; i < 7 && startIdx + i < times.length; i++) {
    const idx = startIdx + i;
    const d = new Date(times[idx]! * 1000);
    hourly.push({
      hour: i === 0 ? "Now" : `${String(d.getHours()).padStart(2, "0")}:00`,
      temperature: Math.round(json.hourly.temperature_2m[idx]!),
      precipitation: json.hourly.precipitation[idx] ?? 0,
      precipProbability: json.hourly.precipitation_probability?.[idx] ?? null,
      weatherCode: json.hourly.weather_code[idx] ?? 0,
    });
  }

  return {
    temperature: Math.round(c.temperature_2m),
    weatherCode: c.weather_code,
    windSpeedMph: Math.round(c.wind_speed_10m),
    humidity: Math.round(c.relative_humidity_2m),
    hourly,
  };
}

async function fetchPollenData(lat: number, lon: number): Promise<PollenData> {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=uv_index,alder_pollen,birch_pollen,grass_pollen,olive_pollen`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Air quality API ${res.status}`);

  const json = await res.json() as {
    current: {
      uv_index?: number | null;
      alder_pollen?: number | null;
      birch_pollen?: number | null;
      grass_pollen?: number | null;
      olive_pollen?: number | null;
    };
  };

  const c = json.current;
  const treePollen = Math.max(
    c.alder_pollen ?? 0,
    c.birch_pollen ?? 0,
    c.olive_pollen ?? 0
  );
  const grassPollen = c.grass_pollen ?? null;

  return {
    treePollen: treePollen > 0 ? treePollen : null,
    grassPollen,
    uvIndex: c.uv_index != null ? Math.round(c.uv_index) : null,
  };
}

// ── Pollen level helpers ─────────────────────────────────────────────────────

function grassPollenLevel(v: number): string {
  if (v < 10) return "Low";
  if (v < 50) return "Mod";
  if (v < 200) return "High";
  return "V.High";
}

function treePollenLevel(v: number): string {
  if (v < 15) return "Low";
  if (v < 90) return "Mod";
  return "High";
}

type PollenLevel = 0 | 1 | 2 | 3;

function pollenLevelRank(label: string): PollenLevel {
  return (["Low", "Mod", "High", "V.High"].indexOf(label) as PollenLevel) ?? 0;
}

function dominantPollenCount(pollen: PollenData): number | null {
  if (pollen.grassPollen == null && pollen.treePollen == null) return null;
  return Math.round(Math.max(pollen.grassPollen ?? 0, pollen.treePollen ?? 0));
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function isDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 20;
}

function isDayHour(hourStr: string): boolean {
  if (hourStr === "Now") return isDaytime();
  const h = parseInt(hourStr.split(":")[0] ?? "12", 10);
  return h >= 6 && h < 20;
}

// ── SVG helpers ──────────────────────────────────────────────────────────────

function embedIcon(png: Buffer | null, x: number, y: number, size: number, svgFallback: string, scale: number): string {
  if (png) {
    return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${png.toString("base64")}"/>`;
  }
  const cx = x + size / 2;
  const cy = y + size / 2;
  return `<g transform="translate(${cx},${cy}) scale(${scale})">${svgFallback}</g>`;
}

// ── SVG builder ──────────────────────────────────────────────────────────────

// Layout constants
const HEADER_H = 82;
const MAIN_TOP = HEADER_H;
const MAIN_BOT = 268;
const DIV_Y = MAIN_BOT;
const HOURLY_TOP = DIV_Y;

// Right panel: icon centred at (595, 175), 156×156
const ICON_SIZE = 156;
const ICON_CX = 596;
const ICON_CY = Math.round((MAIN_TOP + MAIN_BOT) / 2);
const ICON_X = ICON_CX - ICON_SIZE / 2;
const ICON_Y = ICON_CY - ICON_SIZE / 2;

// Hourly strip
const COL_W = W / 7;
const HOUR_Y   = HOURLY_TOP + 34;
const MINI_SIZE = 56;
const MINI_CY  = HOURLY_TOP + 90;
const TEMP_Y   = HOURLY_TOP + 158;
const PRECIP_Y = HOURLY_TOP + 198;

function buildWeatherSvg(
  data: WeatherData,
  pollen: PollenData | null,
  location: string,
  mainIconPng: Buffer | null,
  hourlyIconPngs: (Buffer | null)[]
): string {
  const pollenCount = pollen ? dominantPollenCount(pollen) : null;
  const uvStr = pollen?.uvIndex != null ? String(pollen.uvIndex) : null;
  const headerRight = pollenCount != null ? `Pollen: ${pollenCount}` : "Pollen: n/a";

  // ── Right-panel stats ───────────────────────────────────────────────────────
  // \u00a0 = non-breaking space (won't be collapsed by SVG renderer)
  // \u00b7 = middle dot ·
  const NBSP = "\u00a0";
  const SEP  = `\u00a0\u00a0\u00b7\u00a0\u00a0`;

  const rightParts: string[] = [];
  if (uvStr)      rightParts.push(`UV${NBSP}<tspan font-weight="bold">${escapeXml(uvStr)}</tspan>`);

  const rightStatsSvg = rightParts.length > 0
    ? `<text x="${ICON_CX}" y="${MAIN_BOT - 14}" text-anchor="middle"
        font-family="Arial,Helvetica,sans-serif" font-size="22" fill="black">${rightParts.join(SEP)}</text>`
    : "";

  // ── Hourly columns ──────────────────────────────────────────────────────────
  const hourlyItems = data.hourly.slice(0, 7).map((h, i) => {
    const cx = Math.round((i + 0.5) * COL_W);
    const miniPng = hourlyIconPngs[i] ?? null;
    const miniSvg = embedIcon(miniPng, cx - MINI_SIZE / 2, MINI_CY - MINI_SIZE / 2, MINI_SIZE, fallbackIconSvg(h.weatherCode), 0.24);

    const precipSvg =
      h.precipProbability != null && h.precipProbability >= 20
        ? `<text x="${cx}" y="${PRECIP_Y}" text-anchor="middle"
            font-family="Arial,Helvetica,sans-serif" font-size="20" fill="black">${h.precipProbability}%</text>`
        : h.precipitation > 0.5
          ? `<text x="${cx}" y="${PRECIP_Y}" text-anchor="middle"
              font-family="Arial,Helvetica,sans-serif" font-size="20" fill="black">${h.precipitation.toFixed(1)}mm</text>`
          : "";

    return `
  <text x="${cx}" y="${HOUR_Y}" text-anchor="middle"
    font-family="Arial,Helvetica,sans-serif" font-size="24" fill="black">${escapeXml(h.hour)}</text>
  ${miniSvg}
  <text x="${cx}" y="${TEMP_Y}" text-anchor="middle"
    font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="bold" fill="black">${h.temperature}°</text>
  ${precipSvg}`;
  }).join("");

  // ── Column separators for hourly strip ──────────────────────────────────────
  const colSeps = Array.from({ length: 6 }, (_, i) =>
    `<line x1="${Math.round((i + 1) * COL_W)}" y1="${HOURLY_TOP + 8}" x2="${Math.round((i + 1) * COL_W)}" y2="${H - 8}"
      stroke="black" stroke-width="1"/>`
  ).join("");

  // ── Main icon ───────────────────────────────────────────────────────────────
  const mainIconSvg = embedIcon(mainIconPng, ICON_X, ICON_Y, ICON_SIZE, fallbackIconSvg(data.weatherCode), 0.82);

  // ── Temperature hero ─────────────────────────────────────────────────────────
  const tempCY = Math.round((MAIN_TOP + MAIN_BOT) / 2) - 6;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>

  <!-- ── Inverted header ── -->
  <rect width="${W}" height="${HEADER_H}" fill="black"/>
  <text x="44" y="54"
    font-family="Arial,Helvetica,sans-serif"
    font-size="50" font-weight="bold" fill="white">${escapeXml(location)}</text>
  <text x="${W - 44}" y="54"
    text-anchor="end"
    font-family="Arial,Helvetica,sans-serif"
    font-size="30" fill="white">${escapeXml(headerRight)}</text>

  <!-- ── Temperature hero ── -->
  <text x="214" y="${tempCY}"
    text-anchor="middle" dominant-baseline="middle"
    font-family="Arial,Helvetica,sans-serif"
    font-size="152" font-weight="bold" fill="black">${data.temperature}°</text>

  <!-- ── Left stats: wind + humidity ── -->
  <text x="44" y="${MAIN_BOT - 14}"
    font-family="Arial,Helvetica,sans-serif" font-size="22" fill="black">wind${NBSP}<tspan font-weight="bold">${data.windSpeedMph}${NBSP}mph</tspan>${SEP}hum${NBSP}<tspan font-weight="bold">${data.humidity}%</tspan></text>

  <!-- ── Main weather icon ── -->
  ${mainIconSvg}

  <!-- ── Right stats: UV ── -->
  ${rightStatsSvg}

  <!-- ── Vertical split line (subtle) ── -->
  <line x1="428" y1="${MAIN_TOP + 16}" x2="428" y2="${MAIN_BOT - 16}" stroke="black" stroke-width="1"/>

  <!-- ── Hourly divider ── -->
  <line x1="0" y1="${DIV_Y}" x2="${W}" y2="${DIV_Y}" stroke="black" stroke-width="2"/>

  <!-- ── Column separators ── -->
  ${colSeps}

  <!-- ── Hourly forecast ── -->
  ${hourlyItems}

</svg>`;
}

// ── Public render function ───────────────────────────────────────────────────

export async function renderWeatherBmp(config: Config): Promise<Buffer> {
  // Fetch weather + pollen in parallel; use cache on failure
  const [weatherResult, pollenResult] = await Promise.allSettled([
    fetchWeather(config.weatherLat, config.weatherLon),
    fetchPollenData(config.weatherLat, config.weatherLon),
  ]);

  if (weatherResult.status === "fulfilled") {
    cachedWeather = weatherResult.value;
  } else if (!cachedWeather) {
    throw weatherResult.reason;
  }

  if (pollenResult.status === "fulfilled") {
    cachedPollen = pollenResult.value;
  }
  // silently fall through if pollen fails — it's optional

  const weather = cachedWeather!;
  const pollen = cachedPollen;
  const day = isDaytime();

  // Fetch all icons in parallel (failures return null → SVG fallback)
  const [mainIconPng, ...hourlyIconPngs] = await Promise.all([
    fetchDitheredIcon(weather.weatherCode, ICON_SIZE, day),
    ...weather.hourly.map((h) => fetchDitheredIcon(h.weatherCode, MINI_SIZE, isDayHour(h.hour))),
  ]);

  const svg = buildWeatherSvg(weather, pollen, config.weatherLocation, mainIconPng ?? null, hourlyIconPngs);
  return svgToBmp(svg);
}

export const weatherWidget: WidgetDefinition = {
  name: "weather",
  render: (config) => renderWeatherBmp(config),
  envVars: [
    { name: "WEATHER_LAT",      description: "Latitude for weather location",       required: false },
    { name: "WEATHER_LON",      description: "Longitude for weather location",      required: false },
    { name: "WEATHER_LOCATION", description: "Display name for weather location",   required: false },
  ],
};
