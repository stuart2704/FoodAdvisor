import { logger } from "../lib/logger";
import type { ExternalAdapter, ExternalCandidate } from "../external/candidateTypes";
import { osmAdapter } from "../external/osmAdapter";
import { cityOpenDataAdapter } from "../external/cityOpenDataAdapter";
import { govRegistryAdapter } from "../external/govRegistryAdapter";
import { tourismBoardAdapter } from "../external/tourismBoardAdapter";
import { associationAdapter } from "../external/associationAdapter";
import { storeExternalCandidates } from "../external/candidateStore";
import { validateExternalCandidates } from "../external/candidateValidation";
import { isSuppressed } from "../external/sourceSuppression";
import { sourceQualityScore } from "../external/sourceQuality";

// Only OSM has a live endpoint. Other adapters remain dormant pending real licensed feeds.
const adapters: { name: string; adapter: ExternalAdapter }[] = [
  { name: "OSM", adapter: osmAdapter },
  { name: "CityOpenData", adapter: cityOpenDataAdapter },
  { name: "GovRegistry", adapter: govRegistryAdapter },
  { name: "TourismBoard", adapter: tourismBoardAdapter },
  { name: "RestaurantAssociation", adapter: associationAdapter },
];

export async function runExternalCandidateIngestion(now: Date): Promise<void> {
  logger.info(
    { at: now.toISOString() },
    "External candidate ingestion started (open-data adapters)",
  );

  const results = await Promise.all(
    adapters.map(async ({ name, adapter }) => {
      if (isSuppressed(name)) {
        logger.warn({ adapterName: name }, "Skipping suppressed adapter");
        return { candidates: [] as ExternalCandidate[], error: null as unknown, skipped: name };
      }
      try {
        const candidates = await adapter.fetch({ now });
        validateExternalCandidates(candidates);
        if (candidates.some((candidate) => candidate.sourceName !== name)) {
          throw new Error(`Adapter ${name} returned a candidate from a different source`);
        }
        const quality = sourceQualityScore(candidates);
        logger.info({ adapterName: name, quality, count: candidates.length }, "Source quality score");
        logger.info(
          { adapter: name, count: candidates.length, at: now.toISOString() },
          "Adapter ingestion completed",
        );
        return { candidates, error: null as unknown, skipped: null as string | null };
      } catch (err) {
        logger.error({ err, adapter: name, at: now.toISOString() }, "Adapter ingestion failed");
        return { candidates: [] as ExternalCandidate[], error: err, skipped: null as string | null };
      }
    }),
  );
  const failed = results.find((result) => result.error !== null);
  if (failed) throw failed.error;
  const allCandidates = results.flatMap((result) => result.candidates);

  const unique = new Map<string, ExternalCandidate>();

  for (const c of allCandidates) {
    const key = JSON.stringify([c.sourceName, c.sourceId]);
    if (!unique.has(key)) unique.set(key, c);
  }

  const dedupedCandidates = Array.from(unique.values());
  await storeExternalCandidates(dedupedCandidates, now);

  logger.info(
    {
      at: now.toISOString(),
      adapters: adapters.length,
      skippedAdapters: results.flatMap((result) => result.skipped ? [result.skipped] : []),
      candidatesFetched: allCandidates.length,
      candidatesUnique: dedupedCandidates.length,
    },
    "External candidate ingestion completed (candidates stored as unverified; publication remains disabled)",
  );

  // Only the separate, explicit review workflow may advance a stored candidate.
}