import { routingDecision } from "../external/routingDecision";
import type { Region } from "../external/globalRouter";

/** Advisory selection only; public restaurant search still uses PostgreSQL. */
export async function searchRouter(region: Region) {
  const decision = await routingDecision(region);

  return {
    region,
    searchRegion: decision.routedTo,
    failover: decision.failover,
    reason: decision.reason,
    clusterConnected: decision.clusterConnected,
  };
}