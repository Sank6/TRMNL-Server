import { existsSync } from "fs";
import { join } from "path";
import type { FastifyPluginAsync } from "fastify";
import { DisplayHeadersSchema } from "../schemas/index.js";
import { findDeviceByApiKey, advanceAndGetWidgetIndex } from "../db/devices.js";
import {
  listNonWidgetImages,
  pickImageFromPool,
} from "../utils/images.js";
import type { AppDB } from "../db/index.js";
import type { Config } from "../config.js";
import type { DisplayResponse } from "../types.js";
import { listWidgetStates, isWidgetActiveNow } from "../db/widgets.js";
import { getRefreshRateSeconds } from "../db/settings.js";
import { WIDGETS, getWidgetFilename } from "../widgets/index.js";

/** Sent when the device is not recognised – firmware will show an error screen */
function getUnregisteredResponse(
  refreshRate: number
): Omit<DisplayResponse, "image_url" | "filename"> {
  return {
    status: 202,
    refresh_rate: refreshRate,
    reset_firmware: false,
    update_firmware: false,
    firmware_url: null,
    special_function: "sleep",
  };
}

function listEnabledWidgetImages(db: AppDB, imageDir: string): string[] {
  const stateByName = new Map(
    listWidgetStates(db).map((row) => [row.name, row] as const)
  );

  return WIDGETS
    .filter((widget) => {
      const state = stateByName.get(widget.name);
      if (!state) return true; // not in DB yet → default enabled, no schedule
      return isWidgetActiveNow(state);
    })
    .map((widget) => getWidgetFilename(widget.name))
    .filter((filename) => existsSync(join(imageDir, filename)));
}

export const displayRoute: FastifyPluginAsync<{ db: AppDB; config: Config }> =
  async (fastify, opts) => {
    const { db, config } = opts;

    fastify.get("/api/display", async (request, reply) => {
      const headersParse = DisplayHeadersSchema.safeParse(request.headers);

      // If headers fail basic parse (e.g. ID missing), treat as unregistered
      const mac = headersParse.success ? headersParse.data.id : undefined;
      const accessToken = headersParse.success
        ? headersParse.data["access-token"]
        : undefined;

      const device =
        accessToken ? findDeviceByApiKey(db, accessToken) : undefined;
      const refreshRateSeconds = getRefreshRateSeconds(db, config.refreshRateSeconds);

      if (!device || (mac && device.mac_address !== mac)) {
        const { image_url, filename } = pickImageFromPool(
          config.baseUrl,
          listNonWidgetImages(config.imageDir)
        );
        return reply.status(200).send({
          ...getUnregisteredResponse(refreshRateSeconds),
          image_url,
          filename,
        } satisfies DisplayResponse);
      }

      const widgetIdx = advanceAndGetWidgetIndex(db, device.mac_address);

      const enabledWidgetFiles = listEnabledWidgetImages(db, config.imageDir);
      const fallbackFiles = listNonWidgetImages(config.imageDir);
      const { filename, image_url } = pickImageFromPool(
        config.baseUrl,
        enabledWidgetFiles.length > 0 ? enabledWidgetFiles : fallbackFiles,
        widgetIdx,
        config.imageDir
      );

      const body: DisplayResponse = {
        status: 0,
        image_url,
        filename,
        refresh_rate: refreshRateSeconds,
        reset_firmware: false,
        update_firmware: false,
        firmware_url: null,
        special_function: "sleep",
      };

      return reply.status(200).send(body);
    });
  };
