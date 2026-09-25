import { globalRoute, isRegionSuppressed, type Region } from "./globalRouter";
import { getRegionHealth } from "./regionHealth";

/**
 * Advisory label selection only. There are no cluster probes or network
 * routes wired to this decision.
 */
export function routingDecision(region: Region): {
  region: Region;
  routedTo: Region | null;
  reason: "healthy" | "degraded" | "offline" | "suppressed" | "unknown" | "no_healthy_fallback";
} {
  const health = getRegionHealth(region);
  if (health === "unknown") {
    return { region, routedTo: null, reason: "unknown" };
  }
  if (health === "healthy" && !isRegionSuppressed(region)) {
    return { region, routedTo: region, reason: "healthy" };
  }

  try {
    const fallback = globalRoute(
      region,
      (candidate) => candidate !== region && getRegionHealth(candidate) === "healthy",
    );
    return {
      region,
      routedTo: fallback,
      reason: health === "healthy" ? "suppressed" : health,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "No unsuppressed ingestion region is available.") {
      return { region, routedTo: null, reason: "no_healthy_fallback" };
    }
    throw error;
  }
}