import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { SetupHeadersSchema } from "../schemas/index.js";
import {
  findDeviceByMac,
  createDevice,
  updateDeviceFirmwareInfo,
} from "../db/devices.js";
import { generateFriendlyId } from "../utils/friendly-id.js";
import { pickImage } from "../utils/images.js";
import type { AppDB } from "../db/index.js";
import type { Config } from "../config.js";
import type { SetupResponse } from "../types.js";

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

      const { image_url } = pickImage(config.imageDir, config.baseUrl, device.id);

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
