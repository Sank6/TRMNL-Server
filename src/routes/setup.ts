import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { SetupHeadersSchema } from "../schemas/index.js";
import {
  findDeviceByMac,
  createDevice,
  updateDeviceFirmwareInfo,
} from "../db/devices.js";
import { generateFriendlyId } from "../utils/friendly-id.js";
import { listNonWidgetImages, listWidgetImages, pickImageFromPool } from "../utils/images.js";
import type { AppDB } from "../db/index.js";
import type { Config } from "../config.js";
import type { SetupResponse } from "../types.js";
import { listWidgetStates } from "../db/widgets.js";

function listEnabledWidgetImages(db: AppDB, imageDir: string): string[] {
  const widgetImages = listWidgetImages(imageDir);
  const enabledByName = new Map(
    listWidgetStates(db).map((row) => [row.name, row.enabled === 1] as const)
  );

  return widgetImages.filter((filename) => {
    const name = filename.replace(/^widget-/, "").replace(/\.bmp$/, "");
    return enabledByName.get(name) ?? true;
  });
}

export const setupRoute: FastifyPluginAsync<{ db: AppDB; config: Config }> =
  async (fastify, opts) => {
    const { db, config } = opts;

    fastify.get("/api/setup", async (request, reply) => {
      // Validate the ID header using Zod
      const headersParse = SetupHeadersSchema.safeParse(request.headers);
      if (!headersParse.success) {
        return reply.status(400).send({
          error: "Bad Request",
          message: headersParse.error.issues[0]?.message ?? "Missing ID header",
        });
      }

      const { id: mac, "fw-version": fwVersion, model } = headersParse.data;

      let device = findDeviceByMac(db, mac);

      if (!device) {
        // BYOS auto-register
        device = createDevice(db, {
          mac_address: mac,
          api_key: randomUUID(),
          friendly_id: generateFriendlyId(),
          fw_version: fwVersion,
          model,
          refresh_rate: config.defaultRefreshRate,
        });
      } else {
        // Update firmware info if supplied
        updateDeviceFirmwareInfo(db, mac, fwVersion, model);
      }

      const widgetPool = listEnabledWidgetImages(db, config.imageDir);
      const fallbackPool = listNonWidgetImages(config.imageDir);
      const { image_url } = pickImageFromPool(
        config.baseUrl,
        widgetPool.length > 0 ? widgetPool : fallbackPool,
        device.id
      );

      const body: SetupResponse = {
        status: 200,
        api_key: device.api_key,
        friendly_id: device.friendly_id,
        image_url,
        message: "Welcome to xteink BYOS",
      };

      return reply.status(200).send(body);
    });
  };
