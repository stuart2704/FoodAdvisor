import { pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../lib/logger";
import { runScheduledOsmCities } from "./externalIngestion";
import { acquireIngestionLease } from "../ingestion/lease";
import { storeExternalCandidates } from "../external/candidateStore";
import { globalCities } from "../external/cityList";

export const EXTERNAL_INGESTION_STATE_KEY = "external_ingestion_last_run";
export const EXTERNAL_INGESTION_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FAILED_RETRY_INTERVAL_MS = 60 * 60 * 1000;
let task: ScheduledTask | undefined;

/** Independent of the Google grid crawl; the database records successful runs. */
export async function runExternalIngestionIfDue(now: Date): Promise<void> {
  const lease = await acquireIngestionLease();
  if (!lease) return;
  try {
    const state = await pool.query<{ last_run_at: Date | null; last_attempt_at: Date | null }>(
      "SELECT last_run_at, last_attempt_at FROM external_ingestion_schedule WHERE id = $1",
      [EXTERNAL_INGESTION_STATE_KEY],
    );
    const lastRun = state.rows[0]?.last_run_at;
    if (lastRun && now.getTime() - lastRun.getTime() < EXTERNAL_INGESTION_INTERVAL_MS) return;
    const lastAttempt = state.rows[0]?.last_attempt_at;
    if (lastAttempt && now.getTime() - lastAttempt.getTime() < FAILED_RETRY_INTERVAL_MS) return;

    await lease.commit(async (tx) => {
      await tx.execute(sql`
        INSERT INTO external_ingestion_schedule (id, last_attempt_at)
        VALUES (${EXTERNAL_INGESTION_STATE_KEY}, ${now})
        ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at
      `);
    });
    const completedRows = await pool.query<{ id: string }>(
      "SELECT id FROM external_ingestion_schedule WHERE id LIKE 'scheduled_osm_city:%' AND last_run_at > $1",
      [lastRun ?? new Date(0)],
    );
    const { failed } = await runScheduledOsmCities(now, new Set(completedRows.rows.map((row) => row.id)), {
      signal: lease.signal,
      saveCity: async (key, candidates) => lease.commit(async (tx) => {
        await storeExternalCandidates(candidates, now, tx);
        await tx.execute(sql`
          INSERT INTO external_ingestion_schedule (id, last_run_at) VALUES (${key}, ${now})
          ON CONFLICT (id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at
        `);
      }),
    });
    const summary = failed.length
      ? `${failed.length} of ${globalCities.length} city imports unfinished; ${failed[0].city}: ${failed[0].reason}`
      : null;
    await lease.commit(async (tx) => {
      await tx.execute(sql`
        INSERT INTO external_ingestion_schedule (id, last_run_at, last_attempt_at, last_error_summary)
        VALUES (${EXTERNAL_INGESTION_STATE_KEY}, ${failed.length ? lastRun ?? null : now}, ${now}, ${summary})
        ON CONFLICT (id) DO UPDATE SET
          last_run_at = EXCLUDED.last_run_at,
          last_attempt_at = EXCLUDED.last_attempt_at,
          last_error_summary = EXCLUDED.last_error_summary
      `);
    });
    if (failed.length) logger.warn({ failedCities: failed.map((item) => item.city) }, "Scheduled OSM import incomplete; unfinished cities will retry next check");
  } finally {
    await lease.release();
  }
}

export function startExternalIngestionScheduler(): void {
  if (task) return;
  const check = (now: Date) =>
    runExternalIngestionIfDue(now).catch((err: unknown) => {
      logger.error({ err }, "External candidate ingestion schedule check failed.");
    });
  task = cron.schedule("0 * * * *", () => void check(new Date()), {
    timezone: "Etc/UTC",
    noOverlap: true,
    name: "external-candidate-ingestion",
  });
  void check(new Date());
  logger.info("External candidate ingestion checks hourly; successful runs are at least 12 hours apart.");
}