import { pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../lib/logger";
import { runExternalCandidateIngestion } from "./externalIngestion";
import { acquireIngestionLease } from "../ingestion/lease";
import { storeExternalCandidates } from "../external/candidateStore";

export const EXTERNAL_INGESTION_STATE_KEY = "external_ingestion_last_run";
export const EXTERNAL_INGESTION_INTERVAL_MS = 12 * 60 * 60 * 1000;
let task: ScheduledTask | undefined;

/** Independent of the Google grid crawl; the database records successful runs. */
export async function runExternalIngestionIfDue(now: Date): Promise<void> {
  const lease = await acquireIngestionLease();
  if (!lease) return;
  try {
    const state = await pool.query<{ last_run_at: Date | null }>(
      "SELECT last_run_at FROM external_ingestion_schedule WHERE id = $1",
      [EXTERNAL_INGESTION_STATE_KEY],
    );
    const lastRun = state.rows[0]?.last_run_at;
    if (lastRun && now.getTime() - lastRun.getTime() < EXTERNAL_INGESTION_INTERVAL_MS) return;

    await runExternalCandidateIngestion(now, {
      signal: lease.signal,
      save: async (candidates) => lease.commit(async (tx) => {
        await storeExternalCandidates(candidates, now, tx);
        await tx.execute(
          sql`INSERT INTO external_ingestion_schedule (id, last_run_at)
              VALUES (${EXTERNAL_INGESTION_STATE_KEY}, ${now})
              ON CONFLICT (id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at`,
        );
      }),
    });
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