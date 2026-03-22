import type { AppDB } from "./index.js";
import type { Device } from "../types.js";

export function findDeviceByMac(db: AppDB, mac: string): Device | undefined {
  return db
    .prepare("SELECT * FROM devices WHERE mac_address = ?")
    .get(mac) as Device | undefined;
}

export function findDeviceByApiKey(db: AppDB, apiKey: string): Device | undefined {
  return db
    .prepare("SELECT * FROM devices WHERE api_key = ?")
    .get(apiKey) as Device | undefined;
}

export function createDevice(
  db: AppDB,
  device: {
    mac_address: string;
    api_key: string;
    friendly_id: string;
    fw_version?: string;
    model?: string;
    refresh_rate: number;
  }
): Device {
  db.prepare(`
    INSERT INTO devices (mac_address, api_key, friendly_id, fw_version, model, refresh_rate)
    VALUES (@mac_address, @api_key, @friendly_id, @fw_version, @model, @refresh_rate)
  `).run(device);

  return findDeviceByMac(db, device.mac_address) as Device;
}

export function updateDeviceLastSeen(db: AppDB, mac: string): void {
  db.prepare(
    "UPDATE devices SET last_seen = datetime('now') WHERE mac_address = ?"
  ).run(mac);
}

export function updateDeviceFirmwareInfo(
  db: AppDB,
  mac: string,
  fw_version: string | undefined,
  model: string | undefined
): void {
  db.prepare(`
    UPDATE devices SET fw_version = COALESCE(@fw_version, fw_version),
                       model = COALESCE(@model, model)
    WHERE mac_address = @mac
  `).run({ mac, fw_version: fw_version ?? null, model: model ?? null });
}
