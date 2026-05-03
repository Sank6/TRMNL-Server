import { readFileSync } from "fs";
import { extname, join } from "path";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { Config } from "../config.js";
import { listImages, normalizeRequestedImageFilename } from "../utils/images.js";

const CONTENT_TYPES: Record<string, string> = {
  ".bmp": "image/bmp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export const imageRoute: FastifyPluginAsync<{ config: Config }> = async (fastify, opts) => {
  const { config } = opts;

  async function sendImage(requestedFilename: string, reply: FastifyReply, versioned = false) {
    const filename = normalizeRequestedImageFilename(requestedFilename);

    if (!listImages(config.imageDir).includes(filename)) {
      return reply.code(404).send({ error: "not found" });
    }

    const contentType =
      CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
    const file = readFileSync(join(config.imageDir, filename));

    reply.header("Content-Type", contentType);
    if (versioned) {
      // URL contains a content hash — content is immutable for this URL
      reply.header("Cache-Control", "public, max-age=86400, immutable");
    } else {
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
      reply.header("Pragma", "no-cache");
      reply.header("Expires", "0");
    }

    return reply.send(file);
  }

  fastify.get<{ Params: { filename: string } }>("/images/:filename", async (request, reply) => {
    return sendImage(request.params.filename, reply, false);
  });

  fastify.get<{ Params: { version: string; filename: string } }>(
    "/images/:version/:filename",
    async (request, reply) => {
      return sendImage(request.params.filename, reply, true);
    }
  );
};
