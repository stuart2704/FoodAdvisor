import { routingDecision } from "./routingDecision";
import type { Region } from "./globalRouter";

/** Describes a possible target; does not run ingestion or route traffic. */
export function orchestrateIngestion(region: Region) {
  const decision = routingDecision(region);

  return {
    requestedRegion: region,
    ingestRegion: decision.routedTo,
    reason: decision.reason,
    failover: decision.routedTo !== null && region !== decision.routedTo,
  };
}