import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTestApp, createTestDB, DEVICE_MAC, registerDevice, } from "./helpers.js";
describe("POST /api/log", () => {
    let app;
    let db;
    let apiKey;
    beforeEach(async () => {
        db = createTestDB();
        app = await buildTestApp(db);
        apiKey = await registerDevice(app, DEVICE_MAC);
    });
    afterEach(async () => {
        await app.close();
    });
    const logPayload = {
        battery: 3.85,
        rssi: -65,
        fw_version: "1.0.0",
        message: "boot complete",
        heap_free: 200000,
    };
    it("returns HTTP 204 for a registered device with valid payload", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: DEVICE_MAC,
                "access-token": apiKey,
                "content-type": "application/json",
                accept: "application/json, */*",
            },
            payload: logPayload,
        });
        expect(res.statusCode).toBe(204);
    });
    it("stores the log payload in the device_logs table", async () => {
        await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: DEVICE_MAC,
                "access-token": apiKey,
                "content-type": "application/json",
            },
            payload: logPayload,
        });
        const rows = db
            .prepare("SELECT * FROM device_logs WHERE mac_address = ?")
            .all(DEVICE_MAC);
        expect(rows.length).toBeGreaterThan(0);
        const stored = JSON.parse(rows[0].payload);
        expect(stored.battery).toBe(logPayload.battery);
        expect(stored.message).toBe(logPayload.message);
    });
    it("stores mac_address and api_key from headers in device_logs", async () => {
        await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: DEVICE_MAC,
                "access-token": apiKey,
                "content-type": "application/json",
            },
            payload: logPayload,
        });
        const row = db
            .prepare("SELECT mac_address, api_key FROM device_logs WHERE mac_address = ?")
            .get(DEVICE_MAC);
        expect(row.mac_address).toBe(DEVICE_MAC);
        expect(row.api_key).toBe(apiKey);
    });
    it("returns 204 even for an unknown device (permissive logging)", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: "00:00:00:00:00:00",
                "content-type": "application/json",
            },
            payload: { msg: "hello" },
        });
        expect(res.statusCode).toBe(204);
    });
    it("stores logs from unknown device with null api_key", async () => {
        await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: "00:00:00:00:00:00",
                "content-type": "application/json",
            },
            payload: { msg: "hello from unknown" },
        });
        const row = db
            .prepare("SELECT mac_address, api_key FROM device_logs WHERE mac_address = ?")
            .get("00:00:00:00:00:00");
        expect(row.mac_address).toBe("00:00:00:00:00:00");
        expect(row.api_key).toBeNull();
    });
    it("accepts a large arbitrary JSON payload without error", async () => {
        const bigPayload = {
            data: Array.from({ length: 100 }, (_, i) => ({ index: i, value: `item_${i}` })),
            metadata: { version: "1.0", timestamp: Date.now() },
        };
        const res = await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: DEVICE_MAC,
                "access-token": apiKey,
                "content-type": "application/json",
            },
            payload: bigPayload,
        });
        expect(res.statusCode).toBe(204);
    });
    it("multiple logs from same device all stored", async () => {
        for (let i = 0; i < 3; i++) {
            await app.inject({
                method: "POST",
                url: "/api/log",
                headers: {
                    id: DEVICE_MAC,
                    "access-token": apiKey,
                    "content-type": "application/json",
                },
                payload: { seq: i },
            });
        }
        const rows = db
            .prepare("SELECT * FROM device_logs WHERE mac_address = ?")
            .all(DEVICE_MAC);
        expect(rows.length).toBe(3);
    });
    it("returns 400 when body is not a JSON object (non-JSON content)", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/log",
            headers: {
                id: DEVICE_MAC,
                "access-token": apiKey,
                "content-type": "text/plain",
            },
            payload: "not json",
        });
        expect(res.statusCode).toBe(400);
    });
});
//# sourceMappingURL=log.test.js.map