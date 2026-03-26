import { buildApp } from "../src/app.js";
import { buildDashboard } from "../src/dashboard/server.js";
import type { FastifyInstance } from "fastify";
import type { Config } from "../src/config.js";
import type { AppDB } from "../src/db/index.js";
import { openDatabase } from "../src/db/index.js";

/** In-memory database for each test suite */
export function createTestDB(): AppDB {
  return openDatabase(":memory:");
}

export const TEST_CONFIG: Config = {
  port: 0,
  host: "127.0.0.1",
  baseUrl: "http://localhost:3000",
  dbPath: ":memory:",
  imageDir: "./public/images",
  defaultRefreshRate: 900,
  widgetRefreshIntervalMs: 30000,
  logLevel: "silent",
  weatherLat: 51.5074,
  weatherLon: -0.1278,
  weatherLocation: "London",
  dashboardPort: 3002,
};

export async function buildTestApp(db?: AppDB): Promise<FastifyInstance> {
  const testDb = db ?? createTestDB();
  const app = await buildApp(TEST_CONFIG, testDb);
  return app;
}

export async function buildTestDashboard(db?: AppDB): Promise<FastifyInstance> {
  const testDb = db ?? createTestDB();
  return buildDashboard(TEST_CONFIG, testDb);
}

export const DEVICE_MAC = "AA:BB:CC:DD:EE:FF";
export const DEVICE_MAC_2 = "11:22:33:44:55:66";

/** Registers a device and returns its api_key */
export async function registerDevice(
  app: FastifyInstance,
  mac = DEVICE_MAC
): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/api/setup",
    headers: {
      id: mac,
      "fw-version": "1.0.0",
      model: "xteink-x4",
      "content-type": "application/json",
    },
  });
  const body = res.json<{ api_key: string }>();
  return body.api_key;
}
