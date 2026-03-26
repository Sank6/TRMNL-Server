import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestDashboard, createTestDB } from "./helpers.js";
import type { AppDB } from "../src/db/index.js";

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
});
