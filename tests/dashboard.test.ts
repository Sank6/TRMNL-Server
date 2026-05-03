import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTestDashboard, createTestDB } from "./helpers.js";
import type { AppDB } from "../src/db/index.js";
import { setRefreshRateSeconds } from "../src/db/settings.js";

describe("dashboard widget controls", () => {
  let app: FastifyInstance;
  let db: AppDB;

  beforeEach(async () => {
    db = createTestDB();
    app = await buildTestDashboard(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists widgets with enabled=true by default", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/widgets",
    });

    expect(res.statusCode).toBe(200);
    const widgets = res.json<Array<{ name: string; enabled: boolean }>>();
    expect(widgets.length).toBeGreaterThan(0);
    expect(widgets.every((widget) => widget.enabled === true)).toBe(true);
  });

  it("can disable and re-enable a widget", async () => {
    const disableRes = await app.inject({
      method: "POST",
      url: "/api/widgets/weather/enabled",
      payload: { enabled: false },
    });

    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json<{ enabled: boolean }>().enabled).toBe(false);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/widgets",
    });
    const weatherAfterDisable = listRes
      .json<Array<{ name: string; enabled: boolean }>>()
      .find((widget) => widget.name === "weather");
    expect(weatherAfterDisable?.enabled).toBe(false);

    const enableRes = await app.inject({
      method: "POST",
      url: "/api/widgets/weather/enabled",
      payload: { enabled: true },
    });

    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.json<{ enabled: boolean }>().enabled).toBe(true);
  });

  it("lists registered widgets instead of inferring widget names from files", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "dashboard-widgets-"));
    writeFileSync(join(imageDir, "widget-photos-album-5.bmp"), Buffer.from("orphan"));

    await app.close();
    app = await buildTestDashboard(db, { imageDir });

    const res = await app.inject({
      method: "GET",
      url: "/api/widgets",
    });

    expect(res.statusCode).toBe(200);
    const widgets = res.json<Array<{ name: string }>>();
    expect(widgets.some((widget) => widget.name === "photos")).toBe(true);
    expect(widgets.some((widget) => widget.name === "photos-album-5")).toBe(false);
  });

  it("exposes a faster preview refresh interval for the photos widget", async () => {
    setRefreshRateSeconds(db, 8);

    await app.close();
    app = await buildTestDashboard(db);

    const res = await app.inject({
      method: "GET",
      url: "/api/widgets",
    });

    expect(res.statusCode).toBe(200);
    const widgets = res.json<Array<{
      name: string;
      preview_refresh_ms: number | null;
      preview_refresh_mode: string | null;
    }>>();
    expect(widgets.find((widget) => widget.name === "photos")?.preview_refresh_ms).toBe(4000);
    expect(widgets.find((widget) => widget.name === "photos")?.preview_refresh_mode).toBe("regenerate");
    expect(
      widgets
        .filter((widget) => widget.name !== "photos")
        .every((widget) => (
          widget.preview_refresh_ms === null &&
          widget.preview_refresh_mode === null
        ))
    ).toBe(true);
  });

  it("reads and updates the device refresh rate from the database", async () => {
    const initialRes = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(initialRes.statusCode).toBe(200);
    expect(initialRes.json<{ refresh_rate_seconds: number }>().refresh_rate_seconds).toBe(5);

    const updateRes = await app.inject({
      method: "POST",
      url: "/api/config/refresh-rate",
      payload: { refresh_rate_seconds: 30 },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json<{ refresh_rate_seconds: number }>().refresh_rate_seconds).toBe(30);

    const nextRes = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(nextRes.json<{ refresh_rate_seconds: number }>().refresh_rate_seconds).toBe(30);
  });
});
