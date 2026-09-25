import { routingDecision } from "./routingDecision";
import type { Region } from "./globalRouter";

/** Describes a possible target; does not run ingestion or route traffic. */
export async function orchestrateIngestion(region: Region) {
  const decision = await routingDecision(region);

  return {
    requestedRegion: region,
    ingestRegion: decision.routedTo,
    reason: decision.reason,
    failover: decision.failover,
  };
}