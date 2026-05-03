import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const ORIGINAL_REFRESH_RATE_SECONDS = process.env.REFRESH_RATE_SECONDS;

afterEach(() => {
  if (ORIGINAL_REFRESH_RATE_SECONDS === undefined) {
    delete process.env.REFRESH_RATE_SECONDS;
    return;
  }

  process.env.REFRESH_RATE_SECONDS = ORIGINAL_REFRESH_RATE_SECONDS;
});

describe("loadConfig", () => {
  it("uses REFRESH_RATE_SECONDS from the environment", () => {
    process.env.REFRESH_RATE_SECONDS = "30";

    const config = loadConfig();

    expect(config.refreshRateSeconds).toBe(30);
    expect(config.refreshRateMs).toBe(30000);
  });

  it("throws when REFRESH_RATE_SECONDS is missing", () => {
    delete process.env.REFRESH_RATE_SECONDS;

    expect(() => loadConfig()).toThrow("REFRESH_RATE_SECONDS must be set to a positive integer");
  });

  it("throws when REFRESH_RATE_SECONDS is invalid", () => {
    process.env.REFRESH_RATE_SECONDS = "0";

    expect(() => loadConfig()).toThrow("REFRESH_RATE_SECONDS must be set to a positive integer");
  });
});
