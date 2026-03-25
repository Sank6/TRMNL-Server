import { mkdirSync } from "fs";
import { dirname } from "path";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { buildApp } from "./app.js";
import Bonjour from "bonjour-service";

const config = loadConfig();

// Ensure DB directory exists
mkdirSync(dirname(config.dbPath), { recursive: true });

const db = openDatabase(config.dbPath);
const app = await buildApp(config, db);

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`xteink-server listening on ${config.host}:${config.port}`);
  console.log(`BASE_URL: ${config.baseUrl}`);

  const bonjour = new Bonjour();
  bonjour.publish({ name: "trmnl", type: "http", port: config.port, host: "trmnl.local" });
  console.log(`mDNS: advertising as trmnl.local:${config.port}`);

  process.on("SIGINT", () => { bonjour.unpublishAll(() => process.exit()); });
  process.on("SIGTERM", () => { bonjour.unpublishAll(() => process.exit()); });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
