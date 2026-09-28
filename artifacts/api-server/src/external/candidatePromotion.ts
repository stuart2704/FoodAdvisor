import type { ExternalCandidate } from "./candidateTypes";
import { isReadyForCandidateReview } from "./candidateReviewEligibility";

/**
 * Completeness is only a queueing hint for a human reviewer. Neither result
 * verifies ownership, source rights or location, and neither permits creating
 * a restaurant or contacting anyone.
 */
export function candidateReviewStatus(candidate: ExternalCandidate): "unverified" | "review_ready" {
  return isReadyForCandidateReview(candidate) ? "review_ready" : "unverified";
}