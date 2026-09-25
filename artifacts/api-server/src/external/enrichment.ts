import type { ExternalCandidate } from "./candidateTypes";

function text(value: string | undefined): string | null {
  return value?.trim() || null;
}

function httpUrl(value: string | undefined): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function yesNo(value: string | undefined): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

/** Interprets source tags; this does not verify their accuracy. */
export function enrichCandidate(candidate: ExternalCandidate) {
  const tags = candidate.tags ?? {};

  return {
    menuUrl: httpUrl(tags.menu),
    cuisine: text(tags.cuisine) ?? text(tags["cuisine:primary"]) ?? text(tags.food),
    openingHours: text(tags.opening_hours),
    category: text(tags.category) ?? text(tags.cuisine),
    photoUrl: httpUrl(tags.image),
    takeaway: yesNo(tags.takeaway),
    delivery: yesNo(tags.delivery),
    wheelchairAccessible: yesNo(tags.wheelchair),
    outdoorSeating: yesNo(tags.outdoor_seating),
  };
}