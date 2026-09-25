import { logger } from "../lib/logger";
import type { ExternalAdapter, ExternalCandidate } from "../external/candidateTypes";
import { osmAdapter } from "../external/osmAdapter";
import { cityOpenDataAdapter } from "../external/cityOpenDataAdapter";
import { govRegistryAdapter } from "../external/govRegistryAdapter";
import { tourismBoardAdapter } from "../external/tourismBoardAdapter";
import { associationAdapter } from "../external/associationAdapter";
import { storeExternalCandidates } from "../external/candidateStore";
import { promoteCandidates } from "../external/candidatePromotion";

// Scheduled independently of the Google grid crawl; adapters are currently empty skeletons.
const adapters: ExternalAdapter[] = [
  osmAdapter,
  cityOpenDataAdapter,
  govRegistryAdapter,
  tourismBoardAdapter,
  associationAdapter,
];

export async function runExternalCandidateIngestion(now: Date): Promise<void> {
  logger.info(
    { at: now.toISOString() },
    "External candidate ingestion started (open-data adapters)",
  );

  const allCandidates: ExternalCandidate[] = [];

  for (const adapter of adapters) {
    const candidates = await adapter.fetch({ now });
    allCandidates.push(...candidates);
  }

  const unique = new Map<string, ExternalCandidate>();

  for (const c of allCandidates) {
    const key = `${c.sourceName}:${c.sourceId}`;
    if (!unique.has(key)) unique.set(key, c);
  }

  const dedupedCandidates = Array.from(unique.values());
  await storeExternalCandidates(dedupedCandidates, now);
  await promoteCandidates(dedupedCandidates, now);

  logger.info(
    {
      at: now.toISOString(),
      adapters: adapters.length,
      candidatesFetched: allCandidates.length,
      candidatesUnique: dedupedCandidates.length,
    },
    "External candidate ingestion completed (candidates stored as unverified; promotion is a placeholder)",
  );

  // Promotion remains a no-op until validation and rights checks are implemented.
}