import { mkdirSync } from "fs";
import { dirname } from "path";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { buildApp } from "./app.js";
import { buildDashboard } from "./dashboard/server.js";
import { Bonjour } from "bonjour-service";
import { startWidgets } from "./widgets/index.js";
import { detectLocation } from "./utils/geolocation.js";
import { displayHost, listenWithHostFallback } from "./listen.js";

const config = loadConfig();

if (config.weatherLat == null || config.weatherLon == null) {
  const loc = await detectLocation();
  if (loc) {
    config.weatherLat = loc.lat;
    config.weatherLon = loc.lon;
    if (!config.weatherLocation) config.weatherLocation = loc.city;
  } else {
    console.warn("  ⚠  Could not auto-detect location — set WEATHER_LAT / WEATHER_LON in .env");
    config.weatherLat = 51.5074;
    config.weatherLon = -0.1278;
    if (!config.weatherLocation) config.weatherLocation = "London";
  }
}

// Ensure DB directory exists
mkdirSync(dirname(config.dbPath), { recursive: true });
mkdirSync(config.imageDir, { recursive: true });

const db = openDatabase(config.dbPath, config.refreshRateSeconds);
const app = await buildApp(config, db);

try {
  const apiHost = await listenWithHostFallback(app, {
    port: config.port,
    host: config.host,
    label: "API server",
  });

  const bonjour = new Bonjour();
  bonjour.publish({ name: "trmnl", type: "http", port: config.port, host: "trmnl.local" });

  console.log("");
  console.log("  \x1b[1m\x1b[36mxteink-server\x1b[0m  ready");
  console.log(`  \x1b[2m${"─".repeat(30)}\x1b[0m`);
  console.log(`  \x1b[33m⬡\x1b[0m  Local   \x1b[1mhttp://${displayHost(apiHost)}:${config.port}\x1b[0m`);
  console.log(`  \x1b[33m⬡\x1b[0m  mDNS    \x1b[1mhttp://trmnl.local:${config.port}\x1b[0m`);
  console.log(`  \x1b[33m⬡\x1b[0m  Base    \x1b[2m${config.baseUrl}\x1b[0m`);
  console.log(`  \x1b[33m⬡\x1b[0m  Weather \x1b[2m${config.weatherLocation}\x1b[0m`);
  console.log("");

  const dash = await buildDashboard(config, db);
  const dashboardHost = await listenWithHostFallback(dash, {
    port: config.dashboardPort,
    host: config.host,
    label: "Dashboard server",
  });
  console.log(`  \x1b[33m⬡\x1b[0m  Dashboard  \x1b[1mhttp://${displayHost(dashboardHost)}:${config.dashboardPort}\x1b[0m`);
  console.log(`  \x1b[33m⬡\x1b[0m  Dashboard  \x1b[1mhttp://trmnl.local:${config.dashboardPort}\x1b[0m`);
  console.log("");

  process.on("SIGINT", () => { bonjour.unpublishAll(() => process.exit()); });
  process.on("SIGTERM", () => { bonjour.unpublishAll(() => process.exit()); });

  await startWidgets(config);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
