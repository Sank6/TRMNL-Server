interface DetectedLocation {
  lat: number;
  lon: number;
  city: string;
}

export async function detectLocation(): Promise<DetectedLocation | null> {
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
