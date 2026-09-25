import { orchestrateIngestion } from "./ingestionOrchestrator";
import type { Region } from "./globalRouter";

/** Describes a possible destination; does not publish candidates. */
export function promotionRegion(region: Region) {
  const ingestion = orchestrateIngestion(region);

  return {
    promotionRegion: ingestion.ingestRegion,
    failover: ingestion.failover,
    reason: ingestion.reason,
  };
}