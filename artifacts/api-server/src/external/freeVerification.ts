import type { ExternalCandidate } from "./candidateTypes";
import { normalizeAddress } from "./addressNormalize";
import { validatePhone, validateWebsite } from "./contactValidate";

/** Completeness checks only; a high score does not verify identity or reuse rights. */
export function freeVerify(candidate: ExternalCandidate) {
  const address = normalizeAddress(candidate.rawAddress);
  const phone = validatePhone(candidate.rawPhone);
  const website = validateWebsite(candidate.rawWebsite);

  const checks = {
    hasName: Boolean(candidate.rawName.trim()),
    hasAddress: Boolean(address),
    hasCoords: Boolean(
      candidate.rawCoords &&
      Number.isFinite(candidate.rawCoords.lat) &&
      Number.isFinite(candidate.rawCoords.lon) &&
      Math.abs(candidate.rawCoords.lat) <= 90 &&
      Math.abs(candidate.rawCoords.lon) <= 180,
    ),
    hasPhone: Boolean(phone),
    hasWebsite: Boolean(website),
  };

  const score = Object.values(checks).filter(Boolean).length * 20;
  return { address, phone, website, score, checks };
}