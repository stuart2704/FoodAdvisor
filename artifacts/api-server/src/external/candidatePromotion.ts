import type { ExternalCandidate } from "./candidateTypes";
import { logger } from "../lib/logger";

/**
 * Promote UNVERIFIED candidates into real restaurants.
 * This is where identity resolution, validation, and enrichment happen.
 */
export async function promoteCandidates(
  candidates: ExternalCandidate[],
  now: Date
): Promise<void> {
  if (candidates.length === 0) {
    logger.info(
      { at: now.toISOString() },
      "No candidates to promote (0)"
    );
    return;
  }

  // TODO: implement:
  // - address normalization
  // - phone/email validation
  // - website verification
  // - rights checks
  // - enrichment
  // - restaurant creation
  // - outreach eligibility

  logger.info(
    {
      at: now.toISOString(),
      count: candidates.length,
    },
    "Candidate promotion pipeline executed (placeholder)"
  );
}