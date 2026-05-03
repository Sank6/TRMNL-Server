import { z } from "zod";

/** Headers sent by the device on every request */
export const DeviceHeadersSchema = z.object({
  id: z.string().min(1, "ID header (MAC address) is required"),
});

/** Additional headers only present on /api/setup */
export const SetupHeadersSchema = DeviceHeadersSchema.extend({
  "fw-version": z.string().optional(),
  model: z.string().optional(),
  "content-type": z.string().optional(),
});

/** Headers present on /api/display */
export const DisplayHeadersSchema = DeviceHeadersSchema.extend({
  "access-token": z.string().optional(),
  "refresh-rate": z.string().optional(),
  "battery-voltage": z.string().optional(),
  "fw-version": z.string().optional(),
  model: z.string().optional(),
  rssi: z.string().optional(),
  "temperature-profile": z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  sensors: z.string().optional(),
  special_function: z.string().optional(),
  "content-type": z.string().optional(),
});

/** Headers present on /api/log */
export const LogHeadersSchema = z.object({
  id: z.string().optional(),
  "access-token": z.string().optional(),
  "content-type": z.string().optional(),
  accept: z.string().optional(),
});

/** Body for /api/log – any JSON object */
export const LogBodySchema = z.record(z.unknown());
