import { logger } from "../lib/logger";

/**
 * Candidate-only placeholder. This is deliberately not registered with a
 * scheduler: no approved providers or candidate store are configured yet.
 */
export async function runExternalCandidateIngestion(now: Date): Promise<void> {
  const at = now.toISOString();
  logger.info(
    { at },
    "Starting external candidate ingestion (placeholder; no providers wired)",
  );

  // TODO: Only after approving sources and adding a candidate store, implement
  // stable source IDs, bounded requests, retries, and a persistent run guard.
  // Never insert candidates into restaurant or outreach records here.

  logger.info(
    { at, status: "skipped", candidatesFetched: 0, candidatesStored: 0 },
    "External candidate ingestion completed (placeholder; no candidates fetched or stored)",
  );
}