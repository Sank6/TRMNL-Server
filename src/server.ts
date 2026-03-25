import { mkdirSync } from "fs";
import { dirname } from "path";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { buildApp } from "./app.js";
import { Bonjour } from "bonjour-service";

const config = loadConfig();

// Ensure DB directory exists
mkdirSync(dirname(config.dbPath), { recursive: true });

const db = openDatabase(config.dbPath);
const app = await buildApp(config, db);

try {
  await app.listen({ port: config.port, host: config.host });

  const bonjour = new Bonjour();
  bonjour.publish({ name: "trmnl", type: "http", port: config.port, host: "trmnl.local" });

  console.log("");
  console.log("  \x1b[1m\x1b[36mxteink-server\x1b[0m  ready");
  console.log(`  \x1b[2m${"─".repeat(30)}\x1b[0m`);
  console.log(`  \x1b[33m⬡\x1b[0m  Local   \x1b[1mhttp://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}\x1b[0m`);
  console.log(`  \x1b[33m⬡\x1b[0m  mDNS    \x1b[1mhttp://trmnl.local:${config.port}\x1b[0m`);
  console.log(`  \x1b[33m⬡\x1b[0m  Base    \x1b[2m${config.baseUrl}\x1b[0m`);
  console.log("");

  process.on("SIGINT", () => { bonjour.unpublishAll(() => process.exit()); });
  process.on("SIGTERM", () => { bonjour.unpublishAll(() => process.exit()); });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
