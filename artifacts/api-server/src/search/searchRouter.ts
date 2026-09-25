import { routingDecision } from "../external/routingDecision";
import type { Region } from "../external/globalRouter";

/** Advisory selection only; public restaurant search still uses PostgreSQL. */
export function searchRouter(region: Region) {
  const decision = routingDecision(region);

  return {
    searchRegion: decision.routedTo,
    reason: decision.reason,
    failover: decision.routedTo !== null && region !== decision.routedTo,
  };
}