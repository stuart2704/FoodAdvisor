import type { ExternalCandidate } from "./candidateTypes";

/** Reject malformed source identities before anything can enter the review store. */
export function validateExternalCandidates(candidates: ExternalCandidate[]): void {
  for (const c of candidates) {
    if (
      !c.sourceName || c.sourceName !== c.sourceName.trim() ||
      !c.sourceId || c.sourceId !== c.sourceId.trim() || c.sourceId.length > 512 ||
      !c.rawName?.trim()
    ) {
      throw new Error("External candidate requires a stable source name and ID and a nonempty name.");
    }
    if (
      !Array.isArray(c.sourceFlags) || !c.sourceFlags.every((flag) => typeof flag === "string") ||
      (c.rawCoords && (!Number.isFinite(c.rawCoords.lat) || !Number.isFinite(c.rawCoords.lon) ||
        Math.abs(c.rawCoords.lat) > 90 || Math.abs(c.rawCoords.lon) > 180))
    ) {
      throw new Error("External candidate has invalid source flags or coordinates.");
    }
  }
}