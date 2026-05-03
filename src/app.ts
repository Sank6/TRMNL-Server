import Fastify from "fastify";
import type { Config } from "./config.js";
import type { AppDB } from "./db/index.js";
import requestLoggerPlugin from "./plugins/request-logger.js";
import { setupRoute } from "./routes/setup.js";
import { displayRoute } from "./routes/display.js";
import { imageRoute } from "./routes/images.js";
import { logRoute } from "./routes/log.js";
import { setRuntimeLogLevel } from "./utils/logging.js";

export async function buildApp(config: Config, db: AppDB) {
  setRuntimeLogLevel(config.logLevel);

  const fastify = Fastify({
    disableRequestLogging: true,
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss",
                ignore: "pid,hostname",
                messageFormat: "{msg}",
              },
            },
          },
  });

  // Universal request/response logger (must register before routes)
  await fastify.register(requestLoggerPlugin, { db });

  await fastify.register(imageRoute, { config });

  await fastify.register(setupRoute, { db, config });
  await fastify.register(displayRoute, { db, config });
  await fastify.register(logRoute, { db });

  // Custom 404 handler – still gets logged by the onSend hook
  fastify.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send({ error: "Not Found" });
  });

  return fastify;
}
