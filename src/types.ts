export interface Device {
  id: number;
  mac_address: string;
  api_key: string;
  friendly_id: string;
  fw_version: string | null;
  model: string | null;
  refresh_rate: number;
  created_at: string;
  last_seen: string | null;
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

// /api/setup response
export interface SetupResponse {
  status: number;
  api_key: string;
  friendly_id: string;
  image_url: string;
  message: string;
}

// /api/display response
export interface DisplayResponse {
  status: number;
  image_url: string;
  filename: string;
  refresh_rate: number;
  reset_firmware: boolean;
  update_firmware: boolean;
  firmware_url: string | null;
  special_function: string;
}
