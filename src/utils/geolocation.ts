import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface DetectedLocation {
  lat: number;
  lon: number;
  city: string;
}

// ── Platform-specific device location ────────────────────────────────────────

// Windows: System.Device.Location (.NET Framework) via PowerShell.
// Requires Location Services enabled in Windows Settings > Privacy > Location.
async function getWindowsLocation(): Promise<{ lat: number; lon: number } | null> {
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
    return parseLatLon(stdout);
  } catch {
    return null;
  }
}

// macOS: CoreLocationCLI (https://github.com/fulldecent/corelocation-cli).
// Install with: brew install corelocationcli
// On first run macOS will prompt for location permission.
async function getMacOSLocation(): Promise<{ lat: number; lon: number } | null> {
  try {
    // CoreLocationCLI outputs: latitude,longitude,accuracy (one line)
    const { stdout } = await execFileAsync(
      "CoreLocationCLI",
      ["-once", "-format", "%latitude %longitude"],
      { timeout: 15_000 }
    );
    return parseLatLon(stdout);
  } catch {
    return null;
  }
}

// Linux: GeoClue2 via Python + GObject introspection.
// Requires: python3-gi and GeoClue2 GIR bindings.
//   Ubuntu/Debian: apt install python3-gi gir1.2-geoclue-2.0
//   Fedora:        dnf install python3-gobject geoclue2
//   Arch:          pacman -S python-gobject geoclue
// GeoClue2 must be running (systemd service: geoclue.service).
async function getLinuxLocation(): Promise<{ lat: number; lon: number } | null> {
  const script = [
    "import gi, sys",
    "gi.require_version('Geoclue', '2.0')",
    "from gi.repository import Geoclue",
    "try:",
    "  s = Geoclue.Simple.new_sync('xteink-server', Geoclue.AccuracyLevel.EXACT, None)",
    "  l = s.get_location()",
    "  print(l.get_property('latitude'), l.get_property('longitude'))",
    "except Exception:",
    "  sys.exit(1)",
  ].join("\n");

  try {
    const { stdout } = await execFileAsync(
      "python3",
      ["-c", script],
      { timeout: 15_000 }
    );
    return parseLatLon(stdout);
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseLatLon(stdout: string): { lat: number; lon: number } | null {
  const parts = stdout.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0]!);
  const lon = parseFloat(parts[1]!);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
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

async function getIpLocation(): Promise<DetectedLocation | null> {
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function detectLocation(): Promise<DetectedLocation | null> {
  let coords: { lat: number; lon: number } | null = null;

  if (process.platform === "win32")   coords = await getWindowsLocation();
  else if (process.platform === "darwin") coords = await getMacOSLocation();
  else                                coords = await getLinuxLocation();

  if (coords) {
    const city = await reverseGeocode(coords.lat, coords.lon);
    return { lat: coords.lat, lon: coords.lon, city: city || "Unknown" };
  }

  // Fallback: IP-based (less accurate, no OS dependency)
  return getIpLocation();
}
