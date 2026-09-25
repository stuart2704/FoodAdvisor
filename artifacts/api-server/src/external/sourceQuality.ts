import type { ExternalCandidate } from "./candidateTypes";

/** Batch-size and field-completeness heuristic, not a trust or licensing score. */
export function sourceQualityScore(candidates: ExternalCandidate[]): number {
  const count = candidates.length;
  if (count === 0) return 0;

  let score = 0;
  if (count > 1000) score += 40;
  if (count > 500) score += 20;
  if (count > 100) score += 10;

  const complete = candidates.filter(
    (candidate) => candidate.rawAddress && candidate.rawCoords,
  ).length;
  const completenessRatio = complete / count;
  if (completenessRatio > 0.8) score += 40;
  if (completenessRatio > 0.5) score += 20;

  return Math.min(score, 100);
}