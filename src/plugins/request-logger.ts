import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { insertRequestLog } from "../db/logs.js";
import type { AppDB } from "../db/index.js";

declare module "fastify" {
  interface FastifyRequest {
    _startTime?: bigint;
    _rawBody?: unknown;
  }
}

const requestLoggerPlugin: FastifyPluginAsync<{ db: AppDB }> = async (
  fastify,
  opts
) => {
  const { db } = opts;

  // Capture start time and parse body as early as possible
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    request._startTime = process.hrtime.bigint();
  });

  // After body is parsed, stash it
  fastify.addHook("preHandler", async (request: FastifyRequest) => {
    if (request.body !== undefined) {
      request._rawBody = request.body;
    }
  });

  // After response is sent, write the log row
  fastify.addHook(
    "onSend",
    async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      const durationNs = process.hrtime.bigint() - (request._startTime ?? process.hrtime.bigint());
      const duration_ms = Number(durationNs / 1_000_000n);

      let responseBody: unknown = null;
      if (typeof payload === "string") {
        try {
          responseBody = JSON.parse(payload);
        } catch {
          responseBody = payload;
        }
      }

      try {
        insertRequestLog(db, {
          method: request.method,
          path: request.url.split("?")[0],
          headers: request.headers as Record<string, string | string[] | undefined>,
          body: request._rawBody ?? null,
          status_code: reply.statusCode,
          response: responseBody,
          duration_ms,
        });
      } catch {
        // Never let logging break a response
      }

      return payload;
    }
  );
};

export default fp(requestLoggerPlugin, {
  name: "request-logger",
  fastify: "5.x",
});
