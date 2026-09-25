import { pool } from "@workspace/db";
import cron from "node-cron";
import { logger } from "../lib/logger";

const CLEANUP_BATCH_SIZE = 200;
let task: ReturnType<typeof cron.schedule> | undefined;
let running = false;

/** One indexed, bounded batch. Null descriptions are generation reservations. */
export async function cleanupExpiredAiDescriptions(now = new Date()): Promise<number> {
  const result = await pool.query(
    `WITH expired AS (
       SELECT cache_key
       FROM ai_description_cache
       WHERE expires_at <= $1 AND description IS NOT NULL
       ORDER BY expires_at, cache_key
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ai_description_cache AS cache
     USING expired
     WHERE cache.cache_key = expired.cache_key`,
    [now, CLEANUP_BATCH_SIZE],
  );
  return result.rowCount ?? 0;
}

async function runCleanup(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const deleted = await cleanupExpiredAiDescriptions();
    logger.info({ deleted }, "Expired AI descriptions removed.");
  } catch (error) {
    logger.error({ err: error }, "AI description cache cleanup failed.");
  } finally {
    running = false;
  }
}

export function startAiDescriptionCacheCleanup() {
  if (task) return task;
  task = cron.schedule("15 * * * *", () => void runCleanup(), {
    timezone: "Etc/UTC",
    noOverlap: true,
    name: "ai-description-cache-cleanup",
  });
  void runCleanup();
  return task;
}