import "dotenv/config";

export interface Config {
  port: number;
  host: string;
  baseUrl: string;
  dbPath: string;
  imageDir: string;
  defaultRefreshRate: number;
  logLevel: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    baseUrl: (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    dbPath: process.env.DB_PATH ?? "./data/xteink.db",
    imageDir: process.env.IMAGE_DIR ?? "./public/images",
    defaultRefreshRate: parseInt(process.env.DEFAULT_REFRESH_RATE ?? "900", 10),
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
