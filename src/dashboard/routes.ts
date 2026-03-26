import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import type { FastifyInstance } from "fastify";
import type { AppDB } from "../db/index.js";
import type { Config } from "../config.js";
import { queryRequestLogs, listDeviceLogs } from "../db/logs.js";
import { listDevices } from "../db/devices.js";
import { listWidgetStates, setWidgetEnabled } from "../db/widgets.js";
import { WIDGETS } from "../widgets/index.js";
import {
  fetchFittedPhotoPreviewFromCacheOrSource,
  fetchOriginalPhotoImageFromCacheOrSource,
  getLastPhotosError,
} from "../widgets/photos.js";
import { writeFileSync } from "fs";
import sharp from "sharp";

/** Decode a 1-bit monochrome BMP (as produced by encodeGrayscaleBmp) to PNG. */
async function decode1BitBmpToPng(bmpData: Buffer): Promise<Buffer> {
  const pixelDataOffset = bmpData.readUInt32LE(10);
  const width = bmpData.readInt32LE(18);
  const rawHeight = bmpData.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const rowStride = Math.ceil(width / 32) * 4;

  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const byteOff = pixelDataOffset + srcY * rowStride + (x >> 3);
      const bit = (bmpData[byteOff] >> (7 - (x & 7))) & 1;
      pixels[y * width + x] = bit ? 255 : 0;
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

export async function dashboardRoutes(
  app: FastifyInstance,
  opts: { config: Config; db: AppDB }
): Promise<void> {
  const { config, db } = opts;

  app.get("/api/widgets", async () => {
    const files = readdirSync(config.imageDir).filter(
      (f) => f.startsWith("widget-") && f.endsWith(".bmp")
    ).sort();
    const enabledByName = new Map(
      listWidgetStates(db).map((row) => [row.name, row.enabled === 1] as const)
    );

    return files.map((filename) => {
      const fp = join(config.imageDir, filename);
      const st = statSync(fp);
      const name = filename.replace(/^widget-/, "").replace(/\.bmp$/, "");
      return {
        filename,
        name,
        size: st.size,
        mtime: st.mtime.toISOString(),
        enabled: enabledByName.get(name) ?? true,
      };
    });
  });

  app.post<{ Params: { widget: string }; Body: { enabled?: boolean } }>(
    "/api/widgets/:widget/enabled",
    async (req, reply) => {
      const { widget } = req.params;
      const enabled = req.body?.enabled;
      const w = WIDGETS.find((candidate) => candidate.name === widget);

      if (!w) {
        return reply.code(400).send({ error: "unknown widget" });
      }

      if (typeof enabled !== "boolean") {
        return reply.code(400).send({ error: "enabled must be a boolean" });
      }

      const state = setWidgetEnabled(db, widget, enabled);
      return {
        ok: true,
        name: state.name,
        enabled: state.enabled === 1,
        updated_at: state.updated_at,
      };
    }
  );

  app.get<{ Params: { name: string } }>("/api/widgets/:name.png", async (req, reply) => {
    const { name } = req.params;
    const fp = join(config.imageDir, `widget-${name}.bmp`);
    let bmpData: Buffer;
    try {
      bmpData = readFileSync(fp);
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
    const png = await decode1BitBmpToPng(bmpData);
    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "no-store");
    return reply.send(png);
  });

  app.get("/api/widgets/photos/fitted.png", async (_req, reply) => {
    try {
      const preview = await fetchFittedPhotoPreviewFromCacheOrSource(config.imageDir);
      reply.header("Content-Type", "image/png");
      reply.header("Cache-Control", "no-store");
      return reply.send(preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unavailable";
      console.error("[photos]", message);
      return reply.code(503).send({ error: message });
    }
  });

  app.get("/api/widgets/photos/original.png", async (_req, reply) => {
    try {
      const original = await fetchOriginalPhotoImageFromCacheOrSource(config.imageDir);
      const png = await sharp(original).png().toBuffer();
      reply.header("Content-Type", "image/png");
      reply.header("Cache-Control", "no-store");
      return reply.send(png);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unavailable";
      console.error("[photos]", message);
      return reply.code(503).send({ error: message });
    }
  });

  app.get("/api/widgets/photos/status", async () => {
    return {
      error: getLastPhotosError(),
    };
  });

  app.get<{ Params: { filename: string } }>("/api/preview/:filename", async (req, reply) => {
    const { filename } = req.params;
    if (!filename.startsWith("widget-") || !filename.endsWith(".bmp")) {
      return reply.code(400).send({ error: "invalid filename" });
    }
    const fp = join(config.imageDir, filename);
    let bmpData: Buffer;
    try {
      bmpData = readFileSync(fp);
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
    const png = await decode1BitBmpToPng(bmpData);
    reply.header("Content-Type", "image/png");
    return reply.send(png);
  });

  app.get("/api/logs/ips", async () => {
    const rows = db.prepare(
      "SELECT DISTINCT ip FROM request_logs WHERE ip IS NOT NULL AND ip != '' ORDER BY ip"
    ).all() as { ip: string }[];
    return rows.map((r) => r.ip);
  });

  app.get("/api/logs", async (req) => {
    const q = req.query as Record<string, string>;
    return queryRequestLogs(db, {
      ip: q.ip,
      path: q.path,
      method: q.method,
      status: q.status,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
      q: q.q,
    });
  });

  app.get("/api/device-logs", async (req) => {
    const q = req.query as Record<string, string>;
    return listDeviceLogs(db, {
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
      mac: q.mac,
    });
  });

  app.get("/api/devices", async () => {
    return listDevices(db);
  });

  app.post<{ Params: { widget: string } }>("/api/regenerate/:widget", async (req, reply) => {
    const { widget } = req.params;
    const w = WIDGETS.find((w) => w.name === widget);
    if (!w) return reply.code(400).send({ error: "unknown widget" });
    const buf = await w.render(config);
    const filename = `widget-${widget}.bmp`;
    writeFileSync(join(config.imageDir, filename), buf);
    return { ok: true, filename };
  });
}
