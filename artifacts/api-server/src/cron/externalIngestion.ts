import { logger } from "../lib/logger";

/**
 * External candidate ingestion run.
 *
 * This module is intentionally dormant.
 * It is not scheduled, not triggered by Google budget status,
 * and not wired into runIfDue(). It performs no ingestion work
 * and only logs a skipped/no-op outcome.
 *
 * Real ingestion will be enabled only after:
 * - permitted external sources are confirmed
 * - candidate schema is finalised
 * - deduplication rules exist
 * - stable external IDs are defined
 * - rate limits and retry policies are designed
 * - scheduler wiring is approved
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