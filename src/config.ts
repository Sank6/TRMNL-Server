import "dotenv/config";

const MS_PER_SECOND = 1000;

export interface Config {
  port: number;
  host: string;
  baseUrl: string;
  dbPath: string;
  imageDir: string;
  refreshRateSeconds: number;
  refreshRateMs: number;
  logLevel: string;
  weatherLat: number;
  weatherLon: number;
  weatherLocation: string;
  dashboardPort: number;
}

function parseRequiredPositiveInt(name: string, value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  throw new Error(`${name} must be set to a positive integer`);
}

export function loadConfig(): Config {
  const refreshRateSeconds = parseRequiredPositiveInt(
    "REFRESH_RATE_SECONDS",
    process.env.REFRESH_RATE_SECONDS
  );

  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    baseUrl: (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    dbPath: process.env.DB_PATH ?? "./data/xteink.db",
    imageDir: process.env.IMAGE_DIR ?? "./public/images",
    refreshRateSeconds,
    refreshRateMs: refreshRateSeconds * MS_PER_SECOND,
    logLevel: process.env.LOG_LEVEL ?? "info",
    weatherLat: parseFloat(process.env.WEATHER_LAT ?? "51.5074"),
    weatherLon: parseFloat(process.env.WEATHER_LON ?? "-0.1278"),
    weatherLocation: process.env.WEATHER_LOCATION ?? "London",
    dashboardPort: parseInt(process.env.DASHBOARD_PORT ?? "3001", 10),
  };
}
