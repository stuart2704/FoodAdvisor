import { pool } from "@workspace/db";
import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../lib/logger";
import { runExternalCandidateIngestion } from "./externalIngestion";

export const EXTERNAL_INGESTION_STATE_KEY = "external_ingestion_last_run";
export const EXTERNAL_INGESTION_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const EXTERNAL_INGESTION_LOCK_KEYS = [19068, 2026];
let task: ScheduledTask | undefined;

/** Independent of the Google grid crawl; the database records successful runs. */
export async function runExternalIngestionIfDue(now: Date): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      EXTERNAL_INGESTION_LOCK_KEYS,
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return;

    const state = await client.query<{ last_run_at: Date | null }>(
      "SELECT last_run_at FROM external_ingestion_schedule WHERE id = $1",
      [EXTERNAL_INGESTION_STATE_KEY],
    );
    const lastRun = state.rows[0]?.last_run_at;
    if (lastRun && now.getTime() - lastRun.getTime() < EXTERNAL_INGESTION_INTERVAL_MS) return;

    await runExternalCandidateIngestion(now);
    await client.query(
      `INSERT INTO external_ingestion_schedule (id, last_run_at)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at`,
      [EXTERNAL_INGESTION_STATE_KEY, now],
    );
  } finally {
    try {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock($1, $2)", EXTERNAL_INGESTION_LOCK_KEYS);
      }
    } finally {
      client.release();
    }
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