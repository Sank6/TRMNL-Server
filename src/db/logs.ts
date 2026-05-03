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

export interface RequestLog {
  id: number;
  method: string;
  path: string;
  ip: string | null;
  headers: string;
  body: string | null;
  status_code: number | null;
  response: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface DeviceLog {
  id: number;
  mac_address: string | null;
  api_key: string | null;
  payload: string;
  created_at: string;
}

export function queryRequestLogs(
  db: AppDB,
  opts: {
    ip?: string;
    path?: string;
    method?: string;
    status?: string;
    limit?: number;
    offset?: number;
    q?: string;
  } = {}
): { rows: RequestLog[]; total: number } {
  const { ip, path, method, status, limit = 50, offset = 0, q } = opts;
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (ip) { conditions.push("ip LIKE @ip"); params.ip = `%${ip}%`; }
  if (path) { conditions.push("path LIKE @path"); params.path = `%${path}%`; }
  if (method) { conditions.push("method = @method"); params.method = method.toUpperCase(); }
  if (status) { conditions.push("status_code = @status"); params.status = parseInt(status, 10); }
  if (q) {
    conditions.push("(path LIKE @q OR ip LIKE @q OR response LIKE @q)");
    params.q = `%${q}%`;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) as n FROM request_logs ${where}`).get(params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM request_logs ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset }) as RequestLog[];

  return { rows, total };
}

export function listDeviceLogs(
  db: AppDB,
  opts: { limit?: number; offset?: number; mac?: string } = {}
): { rows: DeviceLog[]; total: number } {
  const { limit = 50, offset = 0, mac } = opts;
  const where = mac ? "WHERE mac_address = @mac" : "";
  const params: Record<string, unknown> = mac ? { mac } : {};

  const total = (db.prepare(`SELECT COUNT(*) as n FROM device_logs ${where}`).get(params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM device_logs ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset }) as DeviceLog[];

  return { rows, total };
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
