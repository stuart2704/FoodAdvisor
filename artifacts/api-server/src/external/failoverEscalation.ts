import type { Region } from "./globalRouter";
import { updateRegionHealth } from "./regionHealth";
import { suppressRegion } from "./regionSuppression";

/**
 * Uses the regional heartbeat, not shared OSM upstream availability.
 * Suppression is process-local and does not reroute live traffic.
 */
export async function escalateFailover(region: Region) {
  const status = await updateRegionHealth(region);

  if (status === "offline") {
    suppressRegion(region);
    return { region, action: "suppressed" as const, reason: "offline" as const };
  }
  if (status === "degraded") {
    return { region, action: "monitor" as const, reason: "degraded" as const };
  }
  if (status === "healthy") {
    return { region, action: "none" as const, reason: "healthy" as const };
  }
  return { region, action: "none" as const, reason: "unknown" as const };
}