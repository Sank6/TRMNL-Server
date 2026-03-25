import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  createTestDB,
  DEVICE_MAC,
  DEVICE_MAC_2,
  registerDevice,
} from "./helpers.js";
import type { AppDB } from "../src/db/index.js";

describe("GET /api/display", () => {
  let app: FastifyInstance;
  let db: AppDB;
  let apiKey: string;

  beforeEach(async () => {
    db = createTestDB();
    app = await buildTestApp(db);
    apiKey = await registerDevice(app, DEVICE_MAC);
  });

  afterEach(async () => {
    await app.close();
  });

  function displayHeaders(mac = DEVICE_MAC, token = apiKey) {
    return {
      id: mac,
      "access-token": token,
      "refresh-rate": "900",
      "battery-voltage": "3.85",
      "fw-version": "1.0.0",
      model: "xteink-x4",
      rssi: "-65",
      "temperature-profile": "true",
      width: "800",
      height: "480",
      "content-type": "application/json",
    };
  }

  it("returns HTTP 200 for a valid registered device", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("response body has status: 0 for a valid device", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const body = res.json<{ status: number }>();
    expect(body.status).toBe(0);
  });

  it("response contains all required fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("image_url");
    expect(body).toHaveProperty("filename");
    expect(body).toHaveProperty("refresh_rate");
    expect(body).toHaveProperty("reset_firmware");
    expect(body).toHaveProperty("update_firmware");
    expect(body).toHaveProperty("firmware_url");
    expect(body).toHaveProperty("special_function");
  });

  it("refresh_rate is a positive integer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const { refresh_rate } = res.json<{ refresh_rate: number }>();
    expect(Number.isInteger(refresh_rate)).toBe(true);
    expect(refresh_rate).toBeGreaterThan(0);
  });

  it("reset_firmware and update_firmware are false by default", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const body = res.json<{ reset_firmware: boolean; update_firmware: boolean }>();
    expect(body.reset_firmware).toBe(false);
    expect(body.update_firmware).toBe(false);
  });

  it("firmware_url is null by default", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const body = res.json<{ firmware_url: null }>();
    expect(body.firmware_url).toBeNull();
  });

  it("image_url is an absolute HTTP URL", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const { image_url } = res.json<{ image_url: string }>();
    expect(image_url).toMatch(/^https?:\/\//);
  });

  it("filename matches the basename of image_url", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const { image_url, filename } = res.json<{
      image_url: string;
      filename: string;
    }>();
    const urlBasename = image_url.split("/").pop();
    expect(filename).toBe(urlBasename);
  });

  it("returns status: 202 when Access-Token is wrong", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(DEVICE_MAC, "wrong-token"),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: number }>();
    expect(body.status).toBe(202);
  });

  it("returns status: 202 when Access-Token is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: number }>();
    expect(body.status).toBe(202);
  });

  it("returns status: 202 when device is not registered", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(DEVICE_MAC_2, "unknown-key"),
    });
    const body = res.json<{ status: number }>();
    expect(body.status).toBe(202);
  });

  it("all optional device telemetry headers accepted without error", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: {
        ...displayHeaders(),
        sensors: '{"temp":22.5}',
        "special_function": "true",
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("updates device last_seen in DB after successful call", async () => {
    const before = (
      db
        .prepare("SELECT last_seen FROM devices WHERE mac_address = ?")
        .get(DEVICE_MAC) as { last_seen: string | null }
    ).last_seen;

    await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const after = (
      db
        .prepare("SELECT last_seen FROM devices WHERE mac_address = ?")
        .get(DEVICE_MAC) as { last_seen: string | null }
    ).last_seen;

    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });
});
