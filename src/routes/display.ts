import type { FastifyPluginAsync } from "fastify";
import { DisplayHeadersSchema } from "../schemas/index.js";
import { findDeviceByApiKey, updateDeviceLastSeen } from "../db/devices.js";
import { pickImage } from "../utils/images.js";
import type { AppDB } from "../db/index.js";
import type { Config } from "../config.js";
import type { DisplayResponse } from "../types.js";

/** Sent when the device is not recognised – firmware will show an error screen */
const UNREGISTERED_RESPONSE: Omit<DisplayResponse, "image_url" | "filename"> = {
  status: 202,
  refresh_rate: 900,
  reset_firmware: false,
  update_firmware: false,
  firmware_url: null,
  special_function: "sleep",
};

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

      // Look up by access token; also verify MAC matches
      const device =
        accessToken ? findDeviceByApiKey(db, accessToken) : undefined;

      if (!device || (mac && device.mac_address !== mac)) {
        const { image_url, filename } = pickImage(config.imageDir, config.baseUrl);
        return reply.status(200).send({
          ...UNREGISTERED_RESPONSE,
          image_url,
          filename,
        } satisfies DisplayResponse);
      }

      updateDeviceLastSeen(db, device.mac_address);

      const { image_url, filename } = pickImage(
        config.imageDir,
        config.baseUrl,
        device.id
      );

      const body: DisplayResponse = {
        status: 0,
        image_url,
        filename,
        refresh_rate: device.refresh_rate,
        reset_firmware: false,
        update_firmware: false,
        firmware_url: null,
        special_function: "sleep",
      };

      return reply.status(200).send(body);
    });
  };
