import { orchestrateIngestion } from "./ingestionOrchestrator";
import type { Region } from "./globalRouter";

/** Describes a possible destination; does not publish candidates. */
export async function promotionRegion(region: Region) {
  const ingestion = await orchestrateIngestion(region);

  return {
    promotionRegion: ingestion.ingestRegion,
    failover: ingestion.failover,
    reason: ingestion.reason,
  };
}