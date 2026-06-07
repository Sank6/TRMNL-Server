import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface DetectedLocation {
  lat: number;
  lon: number;
  city: string;
}

// Uses System.Device.Location (.NET Framework) — same source as Windows Location Services.
// Requires Location Services to be enabled in Windows Settings.
async function getDeviceCoordinates(): Promise<{ lat: number; lon: number } | null> {
  if (process.platform !== "win32") return null;

  const script = `
    Add-Type -AssemblyName System.Device
    $watcher = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::High)
    $watcher.Start()
    $deadline = [DateTime]::Now.AddSeconds(10)
    while ($watcher.Status -ne 'Ready' -and [DateTime]::Now -lt $deadline) { Start-Sleep -Milliseconds 200 }
    $pos = $watcher.Position.Location
    if (-not $pos.IsUnknown) { Write-Output "$($pos.Latitude) $($pos.Longitude)" }
    $watcher.Stop()
  `;

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NonInteractive", "-NoProfile", "-Command", script],
      { timeout: 15_000 }
    );
    const parts = stdout.trim().split(/\s+/);
    if (parts.length >= 2) {
      const lat = parseFloat(parts[0]!);
      const lon = parseFloat(parts[1]!);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
    return null;
  } catch {
    return null;
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6_000),
      headers: { "User-Agent": "xteink-server/1.0" },
    });
    if (!res.ok) return "";
    const json = await res.json() as {
      address?: { city?: string; town?: string; suburb?: string; county?: string };
    };
    const a = json.address;
    return a?.city ?? a?.town ?? a?.suburb ?? a?.county ?? "";
  } catch {
    return "";
  }
}

export async function detectLocation(): Promise<DetectedLocation | null> {
  const coords = await getDeviceCoordinates();
  if (coords) {
    const city = await reverseGeocode(coords.lat, coords.lon);
    return { lat: coords.lat, lon: coords.lon, city: city || "Unknown" };
  }

  // Fallback: IP-based (less accurate but no OS dependency)
  try {
    const res = await fetch("http://ip-api.com/json/?fields=status,lat,lon,city", {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      status: string;
      lat?: number;
      lon?: number;
      city?: string;
    };
    if (json.status !== "success" || json.lat == null || json.lon == null) return null;
    return { lat: json.lat, lon: json.lon, city: json.city ?? "Unknown" };
  } catch {
    return null;
  }
}
