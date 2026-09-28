import { pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { acquireIngestionLease } from "./lease";
import { fetchOsmCandidatesForCity } from "../external/osmAdapter";
import { storeExternalCandidates } from "../external/candidateStore";
import { isSuppressed } from "../external/sourceSuppression";
import { globalCities } from "../external/cityList";
import {
  EXTERNAL_INGESTION_INTERVAL_MS,
} from "../cron/scheduler";

type City = (typeof globalCities)[number];

export type ManualIngestionResult =
  | { status: "completed"; city: string; candidatesFetched: number; verificationStatus: "unverified" }
  | { status: "cooldown"; retryAfterSeconds: number; lastRunAt: string }
  | { status: "busy" }
  | { status: "source_suppressed" };

/** Shares the scheduled job's lease, but keeps a separate 12-hour history per manual city. */
export async function runIngestionForCity(city: City, now: Date): Promise<ManualIngestionResult> {
  const stateKey = `manual_city_ingestion:${city.name.toLowerCase()}`;
  const lease = await acquireIngestionLease();
  if (!lease) return { status: "busy" };
  try {
    const state = await pool.query<{ last_run_at: Date | null }>(
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

    const candidates = await fetchOsmCandidatesForCity(city, now, lease.signal);
    lease.signal.throwIfAborted();
    await lease.commit(async (tx) => {
      await storeExternalCandidates(candidates, now, tx);
      await tx.execute(sql`
        INSERT INTO external_ingestion_schedule (id, last_run_at)
        VALUES (${stateKey}, ${now})
        ON CONFLICT (id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at
      `);
    });
    return {
      status: "completed",
      city: city.name,
      candidatesFetched: candidates.length,
      verificationStatus: "unverified",
    };
  } finally {
    await lease.release();
  }
}