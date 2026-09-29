import { randomUUID } from "node:crypto";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

const LEASE_ID = "external_candidate_ingestion";
const LEASE_SECONDS = 90;
const HEARTBEAT_MS = 20_000;

export type IngestionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class IngestionLeaseLost extends Error {
  constructor() {
    super("External ingestion lease expired or ownership was lost");
  }
}

export async function acquireIngestionLease(): Promise<{
  signal: AbortSignal;
  commit: (write: (tx: IngestionTransaction) => Promise<void>) => Promise<void>;
  release: () => Promise<void>;
} | null> {
  const token = randomUUID();
  // A single committed statement makes takeover atomic across processes and poolers.
  const acquired = await pool.query(
    `INSERT INTO external_ingestion_lease (id, owner_token, expires_at)
     VALUES ($1, $2, clock_timestamp() + ($3 * interval '1 second'))
     ON CONFLICT (id) DO UPDATE SET owner_token = EXCLUDED.owner_token,
       expires_at = EXCLUDED.expires_at
     WHERE external_ingestion_lease.expires_at <= clock_timestamp()
     RETURNING id`,
    [LEASE_ID, token, LEASE_SECONDS],
  );
  if (!acquired.rowCount) return null;

  const controller = new AbortController();
  let stopped = false;
  let lost = false;
  let heartbeat: Promise<void> | undefined;
  const renew = async () => {
    if (stopped || lost) return;
    try {
      const result = await pool.query(
        `UPDATE external_ingestion_lease
         SET expires_at = clock_timestamp() + ($3 * interval '1 second')
         WHERE id = $1 AND owner_token = $2 AND expires_at > clock_timestamp()`,
        [LEASE_ID, token, LEASE_SECONDS],
      );
      if (!result.rowCount) throw new IngestionLeaseLost();
    } catch {
      lost = true;
      controller.abort(new IngestionLeaseLost());
    }
  };
  const timer = setInterval(() => {
    if (!heartbeat) {
      heartbeat = renew().finally(() => { heartbeat = undefined; });
    }
  }, HEARTBEAT_MS);
  timer.unref();

  async function stop() {
    stopped = true;
    clearInterval(timer);
    await heartbeat;
  }
  return {
    signal: controller.signal,
    async commit(write) {
      if (lost) throw new IngestionLeaseLost();
      // Lock the row only for DB writes. A competing takeover waits for this
      // transaction; stale owners cannot write after a takeover has committed.
      await db.transaction(async (tx) => {
        const rows = await tx.execute<{ owner_token: string }>(sql`
          SELECT owner_token FROM external_ingestion_lease
          WHERE id = ${LEASE_ID} AND owner_token = ${token}
            AND expires_at > clock_timestamp()
          FOR UPDATE
        `);
        if (!rows.rows.length) throw new IngestionLeaseLost();
        await write(tx);
      });
    },
    async release() {
      await stop();
      await pool.query(
        "DELETE FROM external_ingestion_lease WHERE id = $1 AND owner_token = $2",
        [LEASE_ID, token],
      );
    },
  };
}