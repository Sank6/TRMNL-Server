import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildTestApp,
  createTestDB,
  DEVICE_MAC,
  DEVICE_MAC_2,
  registerDevice,
} from "./helpers.js";
import type { AppDB } from "../src/db/index.js";
import { setRefreshRateSeconds } from "../src/db/settings.js";
import { setWidgetEnabled } from "../src/db/widgets.js";

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

  it("returns the configured refresh_rate even when the stored device value is stale", async () => {
    db.prepare("UPDATE devices SET refresh_rate = 30 WHERE mac_address = ?").run(
      DEVICE_MAC
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const { refresh_rate } = res.json<{ refresh_rate: number }>();
    expect(refresh_rate).toBe(5);
  });

  it("returns the latest database-backed refresh_rate", async () => {
    setRefreshRateSeconds(db, 30);

    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const { refresh_rate } = res.json<{ refresh_rate: number }>();
    expect(refresh_rate).toBe(30);
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
    const urlBasename = decodeURIComponent(new URL(image_url).pathname.split("/").pop() ?? "");
    expect(filename).toBe(urlBasename);
  });

  it("uses a hashed filename for the photos widget and serves the base photo bmp", async () => {
    const widgetNames = [
      "calendar",
      "photos",
      "weather",
    ];

    for (const name of widgetNames) {
      setWidgetEnabled(db, name, name === "photos");
    }

    const first = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const firstBody = first.json<{ image_url: string; filename: string }>();
    const secondBody = second.json<{ image_url: string; filename: string }>();
    const firstUrl = new URL(firstBody.image_url);
    const secondUrl = new URL(secondBody.image_url);

    expect(firstBody.filename).toMatch(/^widget-photos--[0-9a-f]{12}\.bmp$/);
    expect(secondBody.filename).toMatch(/^widget-photos--[0-9a-f]{12}\.bmp$/);
    expect(firstBody.filename).not.toBe(secondBody.filename);
    expect(firstUrl.pathname).toBe(`/images/${firstBody.filename}`);
    expect(secondUrl.pathname).toBe(`/images/${secondBody.filename}`);
    expect(firstUrl.search).toBe("");
    expect(secondUrl.search).toBe("");

    const canonical = await app.inject({
      method: "GET",
      url: "/images/widget-photos.bmp",
    });
    const firstImage = await app.inject({
      method: "GET",
      url: firstUrl.pathname,
    });
    const secondImage = await app.inject({
      method: "GET",
      url: secondUrl.pathname,
    });

    expect(canonical.statusCode).toBe(200);
    expect(firstImage.statusCode).toBe(200);
    expect(secondImage.statusCode).toBe(200);
    expect(firstImage.headers["content-type"]).toBe("image/bmp");
    expect(secondImage.headers["content-type"]).toBe("image/bmp");
    expect(firstImage.body).toBe(canonical.body);
    expect(secondImage.body).toBe(canonical.body);
  });

  it("serves a content-hashed filename for widget BMPs that changes each render", async () => {
    const widgetNames = [
      "calendar",
      "photos",
      "weather",
    ];

    for (const name of widgetNames) {
      setWidgetEnabled(db, name, name === "weather");
    }

    const first = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const firstBody = first.json<{ image_url: string; filename: string }>();
    const secondBody = second.json<{ image_url: string; filename: string }>();

    expect(firstBody.filename).toMatch(/^widget-weather--[0-9a-f]{12}\.bmp$/);
    expect(secondBody.filename).toMatch(/^widget-weather--[0-9a-f]{12}\.bmp$/);
    expect(firstBody.image_url).not.toBe(secondBody.image_url);
    expect(new URL(firstBody.image_url).pathname).not.toBe(new URL(secondBody.image_url).pathname);
  });

  it("serves the same image file when the cache-busting path changes", async () => {
    const widgetNames = [
      "calendar",
      "photos",
      "weather",
    ];

    for (const name of widgetNames) {
      setWidgetEnabled(db, name, name === "weather");
    }

    const first = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const firstBody = first.json<{ image_url: string }>();
    const secondBody = second.json<{ image_url: string }>();
    const firstUrl = new URL(firstBody.image_url);
    const secondUrl = new URL(secondBody.image_url);

    const firstImage = await app.inject({
      method: "GET",
      url: `${firstUrl.pathname}${firstUrl.search}`,
    });
    const secondImage = await app.inject({
      method: "GET",
      url: `${secondUrl.pathname}${secondUrl.search}`,
    });

    expect(firstImage.statusCode).toBe(200);
    expect(secondImage.statusCode).toBe(200);
    expect(firstImage.headers["content-type"]).toBe("image/bmp");
    expect(secondImage.headers["content-type"]).toBe("image/bmp");
    expect(firstImage.body).toBe(secondImage.body);
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

  it("does not serve disabled widgets to registered devices", async () => {
    const widgetNames = [
      "calendar",
      "photos",
      "weather",
    ];

    for (const name of widgetNames) {
      setWidgetEnabled(db, name, name === "weather");
    }

    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const { filename } = res.json<{ filename: string }>();
    expect(filename).toMatch(/^widget-weather--[0-9a-f]{12}\.bmp$/);
  });

  it("does not serve cached widget-like files to registered devices", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "display-widgets-"));
    writeFileSync(join(imageDir, "widget-weather.bmp"), Buffer.from("weather"));
    writeFileSync(join(imageDir, "widget-photos-album-5.bmp"), Buffer.from("orphan"));

    await app.close();
    app = await buildTestApp(db, { imageDir });
    apiKey = await registerDevice(app, DEVICE_MAC);

    const widgetNames = [
      "calendar",
      "photos",
      "weather",
    ];

    for (const name of widgetNames) {
      setWidgetEnabled(db, name, name === "weather");
    }

    await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/display",
      headers: displayHeaders(),
    });

    const { filename } = res.json<{ filename: string }>();
    expect(filename).toMatch(/^widget-weather--[0-9a-f]{12}\.bmp$/);
  });
});
