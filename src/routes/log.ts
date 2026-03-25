import type { FastifyPluginAsync } from "fastify";
import { LogBodySchema } from "../schemas/index.js";
import { insertDeviceLog } from "../db/logs.js";
import type { AppDB } from "../db/index.js";

export const logRoute: FastifyPluginAsync<{ db: AppDB }> = async (
  fastify,
  opts
) => {
  const { db } = opts;

  fastify.post("/api/log", async (request, reply) => {
    // Must be application/json
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Content-Type must be application/json",
      });
    }

    const bodyParse = LogBodySchema.safeParse(request.body);
    if (!bodyParse.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Body must be a JSON object",
      });
    }

    const mac = (request.headers["id"] as string | undefined) ?? null;
    const apiKey = (request.headers["access-token"] as string | undefined) ?? null;

    insertDeviceLog(db, {
      mac_address: mac,
      api_key: apiKey,
      payload: bodyParse.data,
    });

    return reply.status(204).send();
  });
};
