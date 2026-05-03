import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Config } from "../config.js";
import type { AppDB } from "../db/index.js";
import { dashboardRoutes } from "./routes.js";
import { setRuntimeLogLevel } from "../utils/logging.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildDashboard(config: Config, db: AppDB): Promise<FastifyInstance> {
  setRuntimeLogLevel(config.logLevel);
  const app = Fastify({ logger: false });

  await app.register(dashboardRoutes, { config, db });

  await app.register(fastifyStatic, {
    root: join(__dirname, "../../public/dashboard"),
    prefix: "/",
  });

  return app;
}
