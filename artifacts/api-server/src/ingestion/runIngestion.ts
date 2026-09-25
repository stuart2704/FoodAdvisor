import { pool } from "@workspace/db";
import { fetchOsmCandidatesForCity } from "../external/osmAdapter";
import { storeExternalCandidates } from "../external/candidateStore";
import { isSuppressed } from "../external/sourceSuppression";
import { globalCities } from "../external/cityList";
import {
  EXTERNAL_INGESTION_INTERVAL_MS,
  EXTERNAL_INGESTION_LOCK_KEYS,
} from "../cron/scheduler";

type City = (typeof globalCities)[number];

export type ManualIngestionResult =
  | { status: "completed"; city: string; candidatesFetched: number; verificationStatus: "unverified" }
  | { status: "cooldown"; retryAfterSeconds: number; lastRunAt: string }
  | { status: "busy" }
  | { status: "source_suppressed" };

/** Shares the scheduled job's lock, but keeps a separate 12-hour history per manual city. */
export async function runIngestionForCity(city: City, now: Date): Promise<ManualIngestionResult> {
  const stateKey = `manual_city_ingestion:${city.name.toLowerCase()}`;
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1, $2) AS locked",
      EXTERNAL_INGESTION_LOCK_KEYS,
    );
    if (lock.rows[0]?.locked !== true) return { status: "busy" };

    const state = await client.query<{ last_run_at: Date | null }>(
      "SELECT last_run_at FROM external_ingestion_schedule WHERE id = $1",
      [stateKey],
    );
    const lastRun = state.rows[0]?.last_run_at;
    if (lastRun && now.getTime() - lastRun.getTime() < EXTERNAL_INGESTION_INTERVAL_MS) {
      return {
        status: "cooldown",
        retryAfterSeconds: Math.max(1, Math.ceil(
          (lastRun.getTime() + EXTERNAL_INGESTION_INTERVAL_MS - now.getTime()) / 1000,
        )),
        lastRunAt: lastRun.toISOString(),
      };
    }
    if (isSuppressed("OSM")) return { status: "source_suppressed" };

    const candidates = await fetchOsmCandidatesForCity(city, now);
    await storeExternalCandidates(candidates, now);
    await client.query(
      `INSERT INTO external_ingestion_schedule (id, last_run_at)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at`,
      [stateKey, now],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    return {
      status: "completed",
      city: city.name,
      candidatesFetched: candidates.length,
      verificationStatus: "unverified",
    };
  } finally {
    try {
      if (transactionOpen) await client.query("ROLLBACK");
      client.release();
    } catch (error) {
      client.release(error instanceof Error ? error : new Error("Failed to release ingestion transaction"));
      throw error;
    }
  }
}