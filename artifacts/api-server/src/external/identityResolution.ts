import type { ExternalCandidate } from "./candidateTypes";
import { normalizeAddress } from "./addressNormalize";
import { validatePhone, validateWebsite } from "./contactValidate";

export type ResolvedCandidate = ExternalCandidate & {
  matchedSources: { sourceName: string; sourceId: string }[];
};

function sameOrMissing(left: string | null, right: string | null): boolean {
  return !left || !right || left === right;
}

function compatible(left: ExternalCandidate, right: ExternalCandidate): boolean {
  const a = left.rawCoords;
  const b = right.rawCoords;
  return (
    (!a || !b || (Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lon - b.lon) < 0.002)) &&
    sameOrMissing(validatePhone(left.rawPhone), validatePhone(right.rawPhone)) &&
    sameOrMissing(validateWebsite(left.rawWebsite), validateWebsite(right.rawWebsite))
  );
}

/**
 * Conservative candidate grouping, not proof that records describe one business.
 * The original source identities are retained; do not store only the merged row.
 */
export function resolveIdentity(candidates: ExternalCandidate[]): ResolvedCandidate[] {
  const resolved: ResolvedCandidate[] = [];
  for (const candidate of candidates) {
    const name = candidate.rawName.trim().replace(/\s+/g, " ").toLowerCase();
    const address = normalizeAddress(candidate.rawAddress)?.toLowerCase();
    const existing = name && address
      ? resolved.find((row) =>
          row.rawName.trim().replace(/\s+/g, " ").toLowerCase() === name &&
          normalizeAddress(row.rawAddress)?.toLowerCase() === address &&
          compatible(row, candidate))
      : undefined;

    if (!existing) {
      resolved.push({
        ...candidate,
        matchedSources: [{ sourceName: candidate.sourceName, sourceId: candidate.sourceId }],
      });
      continue;
    }

    if (!existing.matchedSources.some(
      (source) => source.sourceName === candidate.sourceName && source.sourceId === candidate.sourceId,
    )) {
      existing.matchedSources.push({ sourceName: candidate.sourceName, sourceId: candidate.sourceId });
    }
    existing.rawCoords ??= candidate.rawCoords;
    existing.rawPhone ??= candidate.rawPhone;
    existing.rawWebsite ??= candidate.rawWebsite;
    // Keep the primary source's flags: a flag from another source is not proof of reuse rights.
  }
  return resolved;
}