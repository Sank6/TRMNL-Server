import { buildApp } from "../src/app.js";
import { buildDashboard } from "../src/dashboard/server.js";
import { openDatabase } from "../src/db/index.js";
/** In-memory database for each test suite */
export function createTestDB() {
    return openDatabase(":memory:");
}
export const TEST_CONFIG = {
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
export async function buildTestApp(db) {
    const testDb = db ?? createTestDB();
    const app = await buildApp(TEST_CONFIG, testDb);
    return app;
}
export async function buildTestDashboard(db) {
    const testDb = db ?? createTestDB();
    return buildDashboard(TEST_CONFIG, testDb);
}
export const DEVICE_MAC = "AA:BB:CC:DD:EE:FF";
export const DEVICE_MAC_2 = "11:22:33:44:55:66";
/** Registers a device and returns its api_key */
export async function registerDevice(app, mac = DEVICE_MAC) {
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
    const body = res.json();
    return body.api_key;
}
//# sourceMappingURL=helpers.js.map
