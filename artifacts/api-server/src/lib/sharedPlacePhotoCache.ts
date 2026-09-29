import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";

// Temporary provider data only. No image bytes or publication decisions belong here.
const MAX_ENTRIES = 1000; // At most 500 details and 500 media lookups combined.
// @workspace/db's pool defaults to 10 connections. Leave eight available for
// reservePaidPlacesCall (and other DB work) while a provider request is in flight.
const MAX_CACHE_TRANSACTIONS = 2;
let activeTransactions = 0;
const waiting: Array<() => void> = [];
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

async function acquireTransactionSlot(): Promise<() => void> {
  if (activeTransactions >= MAX_CACHE_TRANSACTIONS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    activeTransactions++;
  }
  return () => {
    const next = waiting.shift();
    if (next) next(); // Transfer the occupied slot, rather than freeing it.
    else activeTransactions--;
  };
}

function scheduleCleanup(): void {
  if (cleanupTimer) return;
  // Expired rows must be removed even if no further photo request arrives.
  cleanupTimer = setInterval(() => {
    void pool.query("DELETE FROM place_photo_lookup_cache WHERE expires_at <= now()")
      .catch((error: unknown) => logger.error({ err: error }, "Photo metadata cache cleanup failed"));
  }, 5 * 60 * 1000);
  cleanupTimer.unref();
}

export async function sharedPlacePhotoLookup<T>(
  kind: "details" | "media",
  identifier: string,
  apiKey: string,
  work: () => Promise<T>,
): Promise<T> {
  // Isolate different Google projects without storing either the key or raw identifier.
  const key = createHash("sha256").update(JSON.stringify([kind, identifier, apiKey])).digest("hex");
  const releaseSlot = await acquireTransactionSlot();
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Transaction-scoped: safe with transaction poolers and released on errors/crashes.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 149))", [key]);
      const hit = await client.query<{ value: T }>(
        "SELECT value FROM place_photo_lookup_cache WHERE cache_key = $1 AND kind = $2 AND expires_at > now()",
        [key, kind],
      );
      if (hit.rows.length) {
        await client.query("COMMIT");
        scheduleCleanup();
        return hit.rows[0].value;
      }

      // This remains the ONLY path to the paid provider; work includes the per-call reservation.
      const value = await work();
      // Lock before inserting: pruning cannot wait on another writer that is
      // itself waiting for the prune lock (a cross-key deadlock).
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('place-photo-cache-prune', 149))");
      await client.query(
        `INSERT INTO place_photo_lookup_cache (cache_key, kind, value, expires_at, created_at)
         VALUES ($1, $2, $3::jsonb, now() + interval '30 minutes', now())
         ON CONFLICT (cache_key) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value,
           expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at`,
        [key, kind, JSON.stringify(value)],
      );
      // Serialize the short write/prune only, not independent provider lookups.
      await client.query("DELETE FROM place_photo_lookup_cache WHERE expires_at <= now()");
      await client.query(
        `DELETE FROM place_photo_lookup_cache WHERE cache_key IN (
           SELECT cache_key FROM place_photo_lookup_cache
           ORDER BY created_at DESC, cache_key DESC OFFSET $1
         )`,
        [MAX_ENTRIES],
      );
      await client.query("COMMIT");
      scheduleCleanup();
      return value;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original failure */ }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    releaseSlot();
  }
}