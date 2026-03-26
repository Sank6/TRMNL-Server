import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTestApp, createTestDB, DEVICE_MAC, registerDevice, } from "./helpers.js";
describe("Universal request logger", () => {
    let app;
    let db;
    beforeEach(async () => {
        db = createTestDB();
        app = await buildTestApp(db);
    });
    afterEach(async () => {
        await app.close();
    });
    function getLogs() {
        return db.prepare("SELECT * FROM request_logs ORDER BY id ASC").all();
    }
    it("GET /api/setup creates a row in request_logs", async () => {
        await app.inject({
            method: "GET",
            url: "/api/setup",
            headers: { id: DEVICE_MAC, "content-type": "application/json" },
        });
        const logs = getLogs();
        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0].method).toBe("GET");
        expect(logs[0].path).toBe("/api/setup");
    });
    it("log row has the correct status_code (200) for /api/setup", async () => {
        await app.inject({
            method: "GET",
            url: "/api/setup",
            headers: { id: DEVICE_MAC, "content-type": "application/json" },
        });
        const logs = getLogs();
        expect(logs[0].status_code).toBe(200);
    });
    it("GET /api/display creates a row with status_code 200", async () => {
        const apiKey = await registerDevice(app, DEVICE_MAC);
        // clear setup log
        db.prepare("DELETE FROM request_logs").run();
        await app.inject({
            method: "GET",
            url: "/api/display",
            headers: {
                id: DEVICE_MAC,
                "access-token": apiKey,
                "content-type": "application/json",
            },
        });
        const logs = getLogs();
        expect(logs.length).toBeGreaterThan(0);
        const displayLog = logs.find((l) => l.path === "/api/display");
        expect(displayLog).toBeDefined();
        expect(displayLog.status_code).toBe(200);
    });
    it("POST /api/log creates a row", async () => {
        const apiKey = await registerDevice(app, DEVICE_MAC);
        db.prepare("DELETE FROM request_logs").run();
        await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: DEVICE_MAC,
                "access-token": apiKey,
                "content-type": "application/json",
            },
            payload: { msg: "test" },
        });
        const logs = getLogs();
        expect(logs.find((l) => l.path === "/api/log")).toBeDefined();
    });
    it("HEAD request to /api/setup is logged with method HEAD", async () => {
        await app.inject({
            method: "HEAD",
            url: "/api/setup",
            headers: { id: DEVICE_MAC },
        });
        const logs = getLogs();
        const headLog = logs.find((l) => l.method === "HEAD");
        expect(headLog).toBeDefined();
        expect(headLog.path).toBe("/api/setup");
    });
    it("unknown path (404) is still logged", async () => {
        await app.inject({ method: "GET", url: "/totally/unknown" });
        const logs = getLogs();
        const notFoundLog = logs.find((l) => l.path === "/totally/unknown");
        expect(notFoundLog).toBeDefined();
        expect(notFoundLog.status_code).toBe(404);
    });
    it("duration_ms is populated and >= 0", async () => {
        await app.inject({
            method: "GET",
            url: "/api/setup",
            headers: { id: DEVICE_MAC, "content-type": "application/json" },
        });
        const logs = getLogs();
        expect(logs[0].duration_ms).not.toBeNull();
        expect(logs[0].duration_ms).toBeGreaterThanOrEqual(0);
    });
    it("request headers are stored as a JSON blob containing the id header", async () => {
        await app.inject({
            method: "GET",
            url: "/api/setup",
            headers: { id: DEVICE_MAC, "content-type": "application/json" },
        });
        const logs = getLogs();
        const headers = JSON.parse(logs[0].headers);
        // Fastify lowercases headers
        expect(headers["id"]).toBe(DEVICE_MAC.toLowerCase() === DEVICE_MAC ? DEVICE_MAC : DEVICE_MAC);
    });
    it("response body is stored as a JSON blob for API responses", async () => {
        await app.inject({
            method: "GET",
            url: "/api/setup",
            headers: { id: DEVICE_MAC, "content-type": "application/json" },
        });
        const logs = getLogs();
        expect(logs[0].response).not.toBeNull();
        const response = JSON.parse(logs[0].response);
        expect(response).toHaveProperty("status");
        expect(response).toHaveProperty("api_key");
    });
    it("request body is stored for POST requests", async () => {
        const apiKey = await registerDevice(app, DEVICE_MAC);
        db.prepare("DELETE FROM request_logs").run();
        await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: DEVICE_MAC,
                "access-token": apiKey,
                "content-type": "application/json",
            },
            payload: { battery: 3.7, msg: "hello" },
        });
        const logs = getLogs();
        const logRow = logs.find((l) => l.path === "/api/log");
        expect(logRow.body).not.toBeNull();
        const body = JSON.parse(logRow.body);
        expect(body.battery).toBe(3.7);
    });
});
//# sourceMappingURL=request-logger.test.js.map