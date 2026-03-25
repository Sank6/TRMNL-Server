import "dotenv/config";

export interface Config {
  port: number;
  host: string;
  baseUrl: string;
  dbPath: string;
  imageDir: string;
  defaultRefreshRate: number;
  widgetRefreshIntervalMs: number;
  logLevel: string;
  weatherLat: number;
  weatherLon: number;
  weatherLocation: string;
  dashboardPort: number;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    baseUrl: (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    dbPath: process.env.DB_PATH ?? "./data/xteink.db",
    imageDir: process.env.IMAGE_DIR ?? "./public/images",
    defaultRefreshRate: parseInt(process.env.DEFAULT_REFRESH_RATE ?? "900", 10),
    widgetRefreshIntervalMs: parseInt(process.env.WIDGET_REFRESH_INTERVAL_MS ?? "30000", 10),
    logLevel: process.env.LOG_LEVEL ?? "info",
    weatherLat: parseFloat(process.env.WEATHER_LAT ?? "51.5074"),
    weatherLon: parseFloat(process.env.WEATHER_LON ?? "-0.1278"),
    weatherLocation: process.env.WEATHER_LOCATION ?? "London",
    dashboardPort: parseInt(process.env.DASHBOARD_PORT ?? "3001", 10),
  };
}
