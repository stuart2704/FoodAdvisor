/**
 * Profile offers and events are selected by UTC date. A cached response must
 * expire before the next UTC day, even if it was fetched just before midnight.
 */
export function profileCacheControl(asOf: Date, now = new Date()): string {
  const nextMidnight = Date.parse(`${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`)
    + 24 * 60 * 60 * 1000;
  // Leave a second for response transmission and HTTP Date-header rounding.
  const seconds = Math.min(300, Math.floor((nextMidnight - now.getTime()) / 1000) - 1);
  return seconds > 0 ? `public, max-age=${seconds}` : "no-store";
}