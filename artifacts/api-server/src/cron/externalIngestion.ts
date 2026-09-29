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
import { globalCities } from "../external/cityList";
import { fetchOsmCandidatesForCity } from "../external/osmAdapter";
import { setTimeout as sleep } from "node:timers/promises";

// Only OSM has a live endpoint. Other adapters remain dormant pending real licensed feeds.
const adapters: { name: string; adapter: ExternalAdapter }[] = [
  { name: "OSM", adapter: osmAdapter },
  { name: "CityOpenData", adapter: cityOpenDataAdapter },
  { name: "GovRegistry", adapter: govRegistryAdapter },
  { name: "TourismBoard", adapter: tourismBoardAdapter },
  { name: "RestaurantAssociation", adapter: associationAdapter },
];

export async function runExternalCandidateIngestion(
  now: Date,
  options?: {
    signal?: AbortSignal;
    save?: (candidates: ExternalCandidate[]) => Promise<void>;
  },
): Promise<void> {
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
        const candidates = await adapter.fetch({ now, signal: options?.signal });
        options?.signal?.throwIfAborted();
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
  options?.signal?.throwIfAborted();
  if (options?.save) await options.save(dedupedCandidates);
  else await storeExternalCandidates(dedupedCandidates, now);

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

/** A scheduled pass makes at most one paced request per unfinished city. */
export async function runScheduledOsmCities(
  now: Date,
  completed: ReadonlySet<string>,
  options: {
    signal: AbortSignal;
    saveCity: (key: string, candidates: ExternalCandidate[]) => Promise<void>;
  },
): Promise<{ failed: { city: string; reason: string }[] }> {
  const failed: { city: string; reason: string }[] = [];
  if (isSuppressed("OSM")) {
    return { failed: globalCities
      .filter((city) => !completed.has(`scheduled_osm_city:${city.country}:${city.name.toLowerCase()}`))
      .map((city) => ({ city: city.name, reason: "Source temporarily suppressed" })) };
  }
  let requests = 0;
  for (const city of globalCities) {
    const key = `scheduled_osm_city:${city.country}:${city.name.toLowerCase()}`;
    if (completed.has(key)) continue;
    options.signal.throwIfAborted();
    if (requests++ > 0) await sleep(1_500, undefined, { signal: options.signal });
    let candidates: ExternalCandidate[];
    try {
      candidates = await fetchOsmCandidatesForCity(city, now, options.signal);
      options.signal.throwIfAborted();
      validateExternalCandidates(candidates);
    } catch (error) {
      options.signal.throwIfAborted();
      logger.warn({ err: error, city: city.name }, "Scheduled OSM city import failed");
      // Never send provider response bodies, URLs, or stack traces to the admin UI.
      const message = error instanceof Error ? error.message : "";
      const status = /^OSM Overpass request for .+ failed with status (\d{3})$/.exec(message)?.[1];
      const reason = status ? `Overpass HTTP ${status}` :
        /timeout|timed out/i.test(message) || (error instanceof Error && error.name === "TimeoutError")
          ? "Overpass timed out" : "Import failed";
      failed.push({ city: city.name, reason });
      continue;
    }
    // A storage failure is not a provider failure; stop rather than making more requests.
    await options.saveCity(key, candidates);
  }
  return { failed };
}