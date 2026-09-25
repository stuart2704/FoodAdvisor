import type { ExternalCandidate } from "./candidateTypes";
import { logger } from "../lib/logger";

/**
 * Store external candidates as UNVERIFIED.
 * This does NOT create restaurants.
 * This does NOT trigger outreach.
 * This does NOT fabricate Google fields.
 */
export async function storeExternalCandidates(
  candidates: ExternalCandidate[],
  now: Date
): Promise<void> {
  if (candidates.length === 0) {
    logger.info(
      { at: now.toISOString() },
      "No external candidates to store (0)"
    );
    return;
  }

  // TODO: Replace with your actual DB insert logic.
  // For now, just log the count.
  logger.info(
    {
      at: now.toISOString(),
      count: candidates.length,
    },
    "External candidates ready for storage (UNVERIFIED)"
  );
}