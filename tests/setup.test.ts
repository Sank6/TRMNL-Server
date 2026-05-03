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
  TEST_CONFIG,
} from "./helpers.js";
import type { AppDB } from "../src/db/index.js";
import { setWidgetEnabled } from "../src/db/widgets.js";

describe("GET /api/setup", () => {
  let app: FastifyInstance;
  let db: AppDB;

  beforeEach(async () => {
    db = createTestDB();
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns HTTP 200 for a new device", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("auto-registers new device: body has status 200, api_key, friendly_id, image_url, message", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });
    const body = res.json();
    expect(body.status).toBe(200);
    expect(typeof body.api_key).toBe("string");
    expect(body.api_key.length).toBeGreaterThan(0);
    expect(typeof body.friendly_id).toBe("string");
    expect(body.friendly_id.length).toBeGreaterThan(0);
    expect(typeof body.image_url).toBe("string");
    expect(body.image_url.length).toBeGreaterThan(0);
    expect(typeof body.message).toBe("string");
  });

  it("api_key is a valid UUID v4 format", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });
    const { api_key } = res.json<{ api_key: string }>();
    expect(api_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("image_url uses a versioned path under /images/", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });
    const { image_url } = res.json<{ image_url: string }>();
    const url = new URL(image_url);
    expect(image_url).toMatch(/^https?:\/\//);
    expect(url.pathname).toMatch(/^\/images\/[^/]+\/[^/]+$/);
    expect(url.search).toBe("");
  });

  it("calling setup twice with the same MAC returns the same api_key and friendly_id", async () => {
    const headers = { id: DEVICE_MAC, "content-type": "application/json" };
    const first = await app.inject({ method: "GET", url: "/api/setup", headers });
    const second = await app.inject({ method: "GET", url: "/api/setup", headers });
    const b1 = first.json<{ api_key: string; friendly_id: string }>();
    const b2 = second.json<{ api_key: string; friendly_id: string }>();
    expect(b1.api_key).toBe(b2.api_key);
    expect(b1.friendly_id).toBe(b2.friendly_id);
  });

  it("device row is created in the DB after first call", async () => {
    await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });
    const row = db.prepare("SELECT * FROM devices WHERE mac_address = ?").get(DEVICE_MAC);
    expect(row).toBeDefined();
  });

  it("two different MACs get different api_keys and friendly_ids", async () => {
    const r1 = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });
    const r2 = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC_2, "content-type": "application/json" },
    });
    const b1 = r1.json<{ api_key: string; friendly_id: string }>();
    const b2 = r2.json<{ api_key: string; friendly_id: string }>();
    expect(b1.api_key).not.toBe(b2.api_key);
    expect(b1.friendly_id).not.toBe(b2.friendly_id);
  });

  it("returns 400 when ID header is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("fw_version and model are stored in DB when provided", async () => {
    await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: {
        id: DEVICE_MAC,
        "fw-version": "2.3.1",
        model: "xteink-x4",
        "content-type": "application/json",
      },
    });
    const row = db
      .prepare("SELECT fw_version, model FROM devices WHERE mac_address = ?")
      .get(DEVICE_MAC) as { fw_version: string; model: string };
    expect(row.fw_version).toBe("2.3.1");
    expect(row.model).toBe("xteink-x4");
  });
  it("does not assign disabled widgets during setup", async () => {
    const widgetNames = [
      "calendar",
      "photos",
      "weather",
    ];

    for (const name of widgetNames) {
      setWidgetEnabled(db, name, name === "calendar");
    }

    const res = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });

    const { image_url } = res.json<{ image_url: string }>();
    expect(new URL(image_url).pathname).toMatch(/\/widget-calendar--[0-9a-f]{12}\.bmp$/);
  });

  it("does not treat cached widget-like files as registered widgets during setup", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "setup-widgets-"));
    writeFileSync(join(imageDir, "widget-weather.bmp"), Buffer.from("weather"));
    writeFileSync(join(imageDir, "widget-photos-album-5.bmp"), Buffer.from("orphan"));

    await app.close();
    app = await buildTestApp(db, { imageDir });

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
      url: "/api/setup",
      headers: { id: DEVICE_MAC, "content-type": "application/json" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/setup",
      headers: { id: DEVICE_MAC_2, "content-type": "application/json" },
    });

    const { image_url } = res.json<{ image_url: string }>();
    expect(new URL(image_url).pathname).toMatch(/\/widget-weather--[0-9a-f]{12}\.bmp$/);
  });
});
