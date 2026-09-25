import type { Region } from "./globalRouter";
import type { RegionHealth } from "./regionHealth";

// Shared OSM upstreams, not regional worker or cluster health endpoints.
const endpoints: Record<Region, readonly string[]> = {
  eu: [
    "https://overpass-api.de/api/interpreter",
    "https://nominatim.openstreetmap.org",
  ],
  us: ["https://overpass-api.de/api/interpreter"],
  apac: ["https://overpass-api.de/api/interpreter"],
};

/**
 * Checks whether the configured shared upstream URLs answer HEAD requests.
 * This must not be used to populate regional cluster health or trigger failover.
 */
export async function probeRegion(region: Region): Promise<RegionHealth> {
  const urls = endpoints[region];
  if (!urls) throw new Error(`Unknown upstream probe region: ${region}`);

  let success = 0;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": "TheFoodAdvisor/1.0" },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) success++;
    } catch {
      // A failed or timed-out upstream probe counts as unavailable.
    }
  }
  if (success === urls.length) return "healthy";
  if (success > 0) return "degraded";
  return "offline";
}