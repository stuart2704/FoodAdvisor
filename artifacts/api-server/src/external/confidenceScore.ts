import type { ExternalCandidate } from "./candidateTypes";
import type { ResolvedCandidate } from "./identityResolution";
import { freeVerify } from "./freeVerification";

/** A completeness/ranking signal, not proof of identity or reuse rights. */
export function confidenceScore(candidate: ExternalCandidate | ResolvedCandidate): number {
  const verification = freeVerify(candidate);
  let score = verification.score;

  // Source flags describe one feed; only distinct source identities count as corroboration.
  if ("matchedSources" in candidate &&
      new Set(candidate.matchedSources.map((source) => source.sourceName)).size > 1) {
    score += 10;
  }

  if (verification.website) {
    try {
      const url = new URL(verification.website);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return Math.min(score, 100);
      }
      const domain = url.hostname
        .replace(/^www\./, "")
        .replace(/[^a-z0-9]/g, "");
      const name = candidate.rawName.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (name.length >= 5 && domain.includes(name)) score += 10;
    } catch {
      // validateWebsite may accept non-HTTP URLs; they provide no domain corroboration.
    }
  }

  return Math.min(score, 100);
}