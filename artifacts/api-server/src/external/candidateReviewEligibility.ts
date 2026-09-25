import type { ExternalCandidate } from "./candidateTypes";
import { confidenceScore } from "./confidenceScore";
import { freeVerify } from "./freeVerification";

/**
 * A data-completeness signal for admin review, never owner verification,
 * source-rights approval, publication, or outreach permission.
 */
export function isReadyForCandidateReview(candidate: ExternalCandidate): boolean {
  const { checks } = freeVerify(candidate);
  return checks.hasName && checks.hasAddress && checks.hasCoords &&
    confidenceScore(candidate) >= 85; // confidenceScore uses a 0–100 scale
}