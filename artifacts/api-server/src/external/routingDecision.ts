import { globalRoute, isRegionSuppressed, type Region } from "./globalRouter";
import { getRegionHealth } from "./regionHealth";
import { clusterHeartbeat } from "./clusterHeartbeat";

/**
 * Advisory label selection only. A heartbeat HEAD check does not route traffic.
 * Both an explicit health observation and a reachable heartbeat are required.
 */
export async function routingDecision(region: Region): Promise<{
  region: Region;
  routedTo: Region | null;
  reason: "healthy" | "degraded" | "offline" | "suppressed" | "unknown" | "unreachable" | "no_healthy_fallback";
  failover: boolean;
  clusterConnected: boolean;
}> {
  const health = getRegionHealth(region);
  const primary = await clusterHeartbeat(region);
  if (health === "healthy" && primary.connected && !isRegionSuppressed(region)) {
    return { region, routedTo: region, reason: "healthy", failover: false, clusterConnected: true };
  }

  const attempted = new Set<Region>([region]);
  for (let attempt = 0; attempt < 2; attempt++) {
    let candidate: Region;
    try {
      candidate = globalRoute(
        region,
        (next) => !attempted.has(next) && getRegionHealth(next) === "healthy",
      );
    } catch (error) {
      if (error instanceof Error && error.message === "No unsuppressed ingestion region is available.") break;
      throw error;
    }
    attempted.add(candidate);
    if (!(await clusterHeartbeat(candidate)).connected) continue;
    return {
      region,
      routedTo: candidate,
      reason: health === "healthy"
        ? isRegionSuppressed(region) ? "suppressed" : "unreachable"
        : health,
      failover: true,
      clusterConnected: true,
    };
  }
  return {
    region,
    routedTo: null,
    reason: health === "unknown" ? "unknown" : "no_healthy_fallback",
    failover: false,
    clusterConnected: false,
  };
}