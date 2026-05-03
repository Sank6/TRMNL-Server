import { existsSync, statSync, readFileSync } from "fs";
import { join } from "path";
import type { FastifyInstance } from "fastify";
import type { AppDB } from "../db/index.js";
import type { Config } from "../config.js";
import { queryRequestLogs, listDeviceLogs } from "../db/logs.js";
import { listDevices } from "../db/devices.js";
import {
  getRefreshRateEntry,
  getRefreshRateSeconds,
  setRefreshRateSeconds,
} from "../db/settings.js";
import { listWidgetStates, setWidgetEnabled, setWidgetSchedule } from "../db/widgets.js";
import { WIDGETS, findWidgetByName, getWidgetFilename } from "../widgets/index.js";
import {
  fetchFittedPhotoPreviewFromCacheOrOriginalCache,
  fetchOriginalPhotoImageFromCache,
  getLastPhotosError,
  fetchAlbumPhotoList,
  renderPhotoAtIndex,
  setPhotoIndex,
  prefetchAlbum,
  getPrefetchStatus,
  loadAlbumCacheFromDisk,
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
  loadAlbumCacheFromDisk(config.imageDir);

  app.get("/api/config", async () => {
    const entry = getRefreshRateEntry(db, config.refreshRateSeconds);
    return {
      refresh_rate_seconds: entry.refresh_rate_seconds,
      refresh_rate_ms: entry.refresh_rate_seconds * 1000,
      refresh_rate_updated_at: entry.created_at,
    };
  });

  app.post<{ Body: { refresh_rate_seconds?: number } }>("/api/config/refresh-rate", async (req, reply) => {
    const refreshRateSeconds = Number(req.body?.refresh_rate_seconds);
    if (!Number.isInteger(refreshRateSeconds) || refreshRateSeconds <= 0) {
      return reply.code(400).send({ error: "refresh_rate_seconds must be a positive integer" });
    }

    const entry = setRefreshRateSeconds(db, refreshRateSeconds);
    return {
      refresh_rate_seconds: entry.refresh_rate_seconds,
      refresh_rate_ms: entry.refresh_rate_seconds * 1000,
      refresh_rate_updated_at: entry.created_at,
    };
  });

  app.get("/api/widgets", async () => {
    const refreshRateSeconds = getRefreshRateSeconds(db, config.refreshRateSeconds);
    const refreshRateMs = refreshRateSeconds * 1000;
    const stateByName = new Map(
      listWidgetStates(db).map((row) => [row.name, row] as const)
    );

    return WIDGETS.map((widget) => {
      const filename = getWidgetFilename(widget.name);
      const fp = join(config.imageDir, filename);
      const hasImage = existsSync(fp);
      const st = hasImage ? statSync(fp) : null;
      const state = stateByName.get(widget.name);
      return {
        filename,
        name: widget.name,
        size: st?.size ?? null,
        mtime: st ? st.mtime.toISOString() : null,
        has_image: hasImage,
        enabled: state ? state.enabled === 1 : true,
        schedule_start: state?.schedule_start ?? null,
        schedule_end: state?.schedule_end ?? null,
        refresh_rate_seconds: widget.intervalMs
          ? Math.round(widget.intervalMs / 1000)
          : refreshRateSeconds,
        preview_refresh_ms: widget.dashboard?.previewRefreshMultiplier
          ? Math.max(1, Math.floor(refreshRateMs / widget.dashboard.previewRefreshMultiplier))
          : null,
        preview_refresh_mode: widget.dashboard?.previewRefreshMode ?? null,
        actions: widget.dashboard?.actions ?? [],
      };
    });
  });

  app.post<{ Params: { widget: string }; Body: { enabled?: boolean } }>(
    "/api/widgets/:widget/enabled",
    async (req, reply) => {
      const { widget } = req.params;
      const enabled = req.body?.enabled;
      const w = findWidgetByName(widget);

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

  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

  app.post<{ Params: { widget: string }; Body: { schedule_start?: string | null; schedule_end?: string | null } }>(
    "/api/widgets/:widget/schedule",
    async (req, reply) => {
      const { widget } = req.params;
      const w = findWidgetByName(widget);
      if (!w) return reply.code(400).send({ error: "unknown widget" });

      const start = req.body?.schedule_start ?? null;
      const end   = req.body?.schedule_end   ?? null;

      if (start && !TIME_RE.test(start)) return reply.code(400).send({ error: "schedule_start must be HH:MM" });
      if (end   && !TIME_RE.test(end))   return reply.code(400).send({ error: "schedule_end must be HH:MM"   });
      if (Boolean(start) !== Boolean(end)) {
        return reply.code(400).send({ error: "provide both schedule_start and schedule_end, or neither" });
      }

      const state = setWidgetSchedule(db, widget, start, end);
      return { ok: true, name: state.name, schedule_start: state.schedule_start, schedule_end: state.schedule_end };
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
      const preview = await fetchFittedPhotoPreviewFromCacheOrOriginalCache(config.imageDir);
      if (!preview) {
        return reply.code(404).send({ error: "not cached" });
      }
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
      const original = fetchOriginalPhotoImageFromCache(config.imageDir);
      if (!original) {
        return reply.code(404).send({ error: "not cached" });
      }
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

  app.get("/api/widgets/photos/album", async (_req, reply) => {
    try {
      return await fetchAlbumPhotoList(config.imageDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unavailable";
      console.error("[photos]", message);
      return reply.code(503).send({ error: message });
    }
  });

  app.get<{ Params: { index: string } }>("/api/widgets/photos/album/:index.png", async (req, reply) => {
    const index = parseInt(req.params.index, 10);
    if (!Number.isFinite(index) || index < 0) {
      return reply.code(400).send({ error: "invalid index" });
    }
    try {
      const bmpData = renderPhotoAtIndex(index);
      const png = await decode1BitBmpToPng(bmpData);
      reply.header("Content-Type", "image/png");
      reply.header("Cache-Control", "no-store");
      return reply.send(png);
    } catch (error) {
      return reply.code(404).send({ error: "not cached" });
    }
  });

  app.post("/api/widgets/photos/album/prefetch", async (_req, _reply) => {
    prefetchAlbum(config.imageDir); // fire-and-forget; poll /status for progress
    return getPrefetchStatus();
  });

  app.get("/api/widgets/photos/album/prefetch/status", async () => {
    return getPrefetchStatus();
  });

  app.post<{ Body: { index?: number } }>("/api/widgets/photos/index", async (req, reply) => {
    const { index } = req.body ?? {};
    if (typeof index !== "number" || !Number.isFinite(index) || index < 0) {
      return reply.code(400).send({ error: "index must be a non-negative integer" });
    }
    setPhotoIndex(index, config.imageDir);
    const w = findWidgetByName("photos");
    if (w) {
      const buf = await w.render(config);
      writeFileSync(join(config.imageDir, "widget-photos.bmp"), buf);
    }
    return { ok: true, index };
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
    const w = findWidgetByName(widget);
    if (!w) return reply.code(400).send({ error: "unknown widget" });
    const buf = await w.render(config);
    const renderError = getLastPhotosError();
    if (widget === "photos" && renderError) {
      return reply.code(503).send({ error: renderError });
    }
    const filename = `widget-${widget}.bmp`;
    writeFileSync(join(config.imageDir, filename), buf);
    return { ok: true, filename };
  });
}
