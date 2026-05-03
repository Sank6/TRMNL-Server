import { existsSync } from "fs";
import { join } from "path";
import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { SetupHeadersSchema } from "../schemas/index.js";
import {
  findDeviceByMac,
  createDevice,
  updateDeviceFirmwareInfo,
} from "../db/devices.js";
import { generateFriendlyId } from "../utils/friendly-id.js";
import { listNonWidgetImages, pickImageFromPool } from "../utils/images.js";
import type { AppDB } from "../db/index.js";
import type { Config } from "../config.js";
import type { SetupResponse } from "../types.js";
import { getRefreshRateSeconds } from "../db/settings.js";
import { listWidgetStates, isWidgetActiveNow } from "../db/widgets.js";
import { WIDGETS, getWidgetFilename } from "../widgets/index.js";

function listEnabledWidgetImages(db: AppDB, imageDir: string): string[] {
  const stateByName = new Map(
    listWidgetStates(db).map((row) => [row.name, row] as const)
  );

  return WIDGETS
    .filter((widget) => {
      const state = stateByName.get(widget.name);
      if (!state) return true;
      return isWidgetActiveNow(state);
    })
    .map((widget) => getWidgetFilename(widget.name))
    .filter((filename) => existsSync(join(imageDir, filename)));
}

export const setupRoute: FastifyPluginAsync<{ db: AppDB; config: Config }> =
  async (fastify, opts) => {
    const { db, config } = opts;

    fastify.get("/api/setup", async (request, reply) => {
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
        device = createDevice(db, {
          mac_address: mac,
          api_key: randomUUID(),
          friendly_id: generateFriendlyId(),
          fw_version: fwVersion,
          model,
          refresh_rate: getRefreshRateSeconds(db, config.refreshRateSeconds),
        });
      } else {
        updateDeviceFirmwareInfo(db, mac, fwVersion, model);
      }

      const widgetPool = listEnabledWidgetImages(db, config.imageDir);
      const fallbackPool = listNonWidgetImages(config.imageDir);
      const { image_url } = pickImageFromPool(
        config.baseUrl,
        widgetPool.length > 0 ? widgetPool : fallbackPool,
        device.id,
        config.imageDir
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
