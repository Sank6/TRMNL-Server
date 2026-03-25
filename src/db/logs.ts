import type { AppDB } from "./index.js";

export function insertRequestLog(
  db: AppDB,
  entry: {
    method: string;
    path: string;
    ip: string | null;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    status_code: number;
    response: unknown;
    duration_ms: number;
  }
): void {
  db.prepare(`
    INSERT INTO request_logs (method, path, ip, headers, body, status_code, response, duration_ms)
    VALUES (@method, @path, @ip, @headers, @body, @status_code, @response, @duration_ms)
  `).run({
    method: entry.method,
    path: entry.path,
    ip: entry.ip,
    headers: JSON.stringify(entry.headers),
    body: entry.body != null ? JSON.stringify(entry.body) : null,
    status_code: entry.status_code,
    response: entry.response != null ? JSON.stringify(entry.response) : null,
    duration_ms: entry.duration_ms,
  });
}

export function insertDeviceLog(
  db: AppDB,
  entry: {
    mac_address: string | null;
    api_key: string | null;
    payload: unknown;
  }
): void {
  db.prepare(`
    INSERT INTO device_logs (mac_address, api_key, payload)
    VALUES (@mac_address, @api_key, @payload)
  `).run({
    mac_address: entry.mac_address,
    api_key: entry.api_key,
    payload: JSON.stringify(entry.payload),
  });
}
