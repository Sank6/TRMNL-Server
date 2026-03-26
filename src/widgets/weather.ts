import { svgToBmp, DISPLAY_WIDTH, DISPLAY_HEIGHT } from "./image-pipeline.js";
import type { Config } from "../config.js";
import type { WidgetDefinition } from "./types.js";

const W = DISPLAY_WIDTH;
const H = DISPLAY_HEIGHT;

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

// ── WMO weather code mappings ───────────────────────────────────────────────

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

/** Returns SVG elements for a weather icon, centred at (0, 0). */
function weatherIconSvg(code: number): string {
  const cloud = `<path d="M -90,25 Q -90,-25 -50,-25 Q -44,-68 5,-68 Q 56,-68 62,-25 Q 92,-25 92,16 Q 92,52 52,52 L -60,52 Q -92,52 -92,25 Z"
      fill="none" stroke="black" stroke-width="11" stroke-linejoin="round"/>`;

  const sun = `
    <circle r="54" fill="none" stroke="black" stroke-width="11"/>
    <line x1="0" y1="-80" x2="0" y2="-64" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="80" y1="0" x2="64" y2="0" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="0" y1="80" x2="0" y2="64" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-80" y1="0" x2="-64" y2="0" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="56" y1="-56" x2="45" y2="-45" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="56" y1="56" x2="45" y2="45" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-56" y1="56" x2="-45" y2="45" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-56" y1="-56" x2="-45" y2="-45" stroke="black" stroke-width="9" stroke-linecap="round"/>`;

  const partlyCloudy = `
    <circle cx="42" cy="-50" r="40" fill="none" stroke="black" stroke-width="9"/>
    <line x1="42" y1="-100" x2="42" y2="-87" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="42" y1="0" x2="42" y2="-13" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="92" y1="-50" x2="79" y2="-50" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="-8" y1="-50" x2="5" y2="-50" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="76" y1="-84" x2="67" y2="-75" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="76" y1="-16" x2="67" y2="-25" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="8" y1="-16" x2="17" y2="-25" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <line x1="8" y1="-84" x2="17" y2="-75" stroke="black" stroke-width="8" stroke-linecap="round"/>
    <path d="M -90,25 Q -90,-25 -50,-25 Q -44,-68 5,-68 Q 56,-68 62,-25 Q 92,-25 92,16 Q 92,52 52,52 L -60,52 Q -92,52 -92,25 Z"
      fill="white" stroke="black" stroke-width="11" stroke-linejoin="round"/>`;

  const rain = `
    <line x1="-52" y1="68" x2="-64" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="0" y1="68" x2="-12" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="52" y1="68" x2="40" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>`;

  const snow = `
    <line x1="-52" y1="70" x2="-52" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-68" y1="87" x2="-36" y2="87" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="0" y1="70" x2="0" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="-16" y1="87" x2="16" y2="87" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="52" y1="70" x2="52" y2="104" stroke="black" stroke-width="9" stroke-linecap="round"/>
    <line x1="36" y1="87" x2="68" y2="87" stroke="black" stroke-width="9" stroke-linecap="round"/>`;

  const lightning = `
    <polyline points="12,64 -22,106 12,106 -12,148"
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

// ── Weather API ─────────────────────────────────────────────────────────────

let cachedWeather: WeatherData | null = null;

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

  // Find hourly index for the current hour
  const currentHourMs = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const times = json.hourly.time;
  let startIdx = times.findIndex((t) => t * 1000 >= currentHourMs);
  if (startIdx < 0) startIdx = 0;

  const hourly: HourlyEntry[] = [];
  for (let i = 0; i < 7 && startIdx + i < times.length; i++) {
    const idx = startIdx + i;
    const d = new Date(times[idx] * 1000);
    hourly.push({
      hour: `${String(d.getHours()).padStart(2, "0")}:00`,
      temperature: Math.round(json.hourly.temperature_2m[idx]),
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

// ── SVG builder ─────────────────────────────────────────────────────────────

function buildWeatherSvg(data: WeatherData, location: string): string {
  const desc = weatherDescription(data.weatherCode);
  const icon = weatherIconSvg(data.weatherCode);

  // ── Zone boundaries ──────────────────────────────────────────────────────────
  // Header:   y=0   → y=74   (divider at 74)
  // Current:  y=74  → y=282  (divider at 282)  centre=178
  // Hourly:   y=282 → y=480
  const DIV1 = 74;
  const DIV2 = 282;

  const COLS = 7;
  const colW = W / COLS;

  // Hourly columns — each column centred on its slot
  const hourlyItems = data.hourly.slice(0, COLS).map((h, i) => {
    const cx = ((i + 0.5) * colW).toFixed(1);
    const miniIcon = weatherIconSvg(h.weatherCode);
    const precipDisplay = h.precipProbability !== null
      ? `${h.precipProbability}%`
      : h.precipitation > 0 ? `${h.precipitation.toFixed(1)}mm` : "\u2014";
    return `
  <text x="${cx}" y="${DIV2 + 30}" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif" font-size="24" fill="black">${h.hour}</text>
  <g transform="translate(${cx}, ${DIV2 + 84}) scale(0.30)">${miniIcon}</g>
  <text x="${cx}" y="${DIV2 + 138}" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="bold" fill="black">${h.temperature}°</text>
  <text x="${cx}" y="${DIV2 + 172}" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif" font-size="22" fill="black">${precipDisplay}</text>`;
  }).join("");

  // Current conditions: temperature left-centre, icon right-centre, both at zone mid y=178
  // Temperature centred at (210, 178). Icon centred at (590, 178).
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>

  <!-- Header: location + condition -->
  <text x="44" y="52"
    font-family="Arial, Helvetica, sans-serif"
    font-size="46" font-weight="bold" fill="black">${location}</text>
  <text x="${W - 44}" y="52"
    text-anchor="end"
    font-family="Arial, Helvetica, sans-serif"
    font-size="36" fill="#333">${desc}</text>

  <line x1="0" y1="${DIV1}" x2="${W}" y2="${DIV1}" stroke="black" stroke-width="1"/>

  <!-- Current temperature — left half, centred in current zone -->
  <text x="210" y="178"
    text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="150" font-weight="bold" fill="black">${data.temperature}°</text>

  <!-- Current weather icon — right half, centred in current zone -->
  <g transform="translate(590, 178)">${icon}</g>

  <line x1="0" y1="${DIV2}" x2="${W}" y2="${DIV2}" stroke="black" stroke-width="1"/>

  <!-- Hourly forecast -->
  ${hourlyItems}
</svg>`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function renderWeatherBmp(config: Config): Promise<Buffer> {
  try {
    cachedWeather = await fetchWeather(config.weatherLat, config.weatherLon);
  } catch (err) {
    if (!cachedWeather) throw err;
    // use cached data if fetch fails
  }

  const svg = buildWeatherSvg(cachedWeather!, config.weatherLocation);
  return svgToBmp(svg);
}

export const weatherWidget: WidgetDefinition = {
  name: "weather",
  render: (config) => renderWeatherBmp(config),
  envVars: [
    { name: "WEATHER_LAT", description: "Latitude for weather location", required: false },
    { name: "WEATHER_LON", description: "Longitude for weather location", required: false },
    { name: "WEATHER_LOCATION", description: "Display name for weather location", required: false },
  ],
};
