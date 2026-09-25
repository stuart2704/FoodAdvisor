import type { Region } from "./globalRouter";

export type RegionHealth = "healthy" | "degraded" | "offline";

// Process-local observations only. No cluster probes or live routing use these.
const health: Partial<Record<Region, RegionHealth>> = {};
const regions: readonly Region[] = ["eu", "us", "apac"];

function assertRegion(region: Region): void {
  if (!regions.includes(region)) throw new Error(`Unknown ingestion region: ${region}`);
}

export function setRegionHealth(region: Region, status: RegionHealth): void {
  assertRegion(region);
  if (!["healthy", "degraded", "offline"].includes(status)) {
    throw new Error(`Unknown region health status: ${status}`);
  }
  health[region] = status;
}

export function getRegionHealth(region: Region): RegionHealth | "unknown" {
  assertRegion(region);
  return health[region] ?? "unknown";
}