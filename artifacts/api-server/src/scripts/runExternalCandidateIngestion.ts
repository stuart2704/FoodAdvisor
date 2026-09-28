import { runExternalCandidateIngestion } from "../cron/externalIngestion";
import { logger } from "../lib/logger";
import { acquireIngestionLease } from "../ingestion/lease";
import { storeExternalCandidates } from "../external/candidateStore";

const now = new Date();

try {
  const lease = await acquireIngestionLease();
  if (!lease) throw new Error("Another external candidate ingestion is already in progress");
  try {
    await runExternalCandidateIngestion(now, {
      signal: lease.signal,
      save: async (candidates) => lease.commit((tx) => storeExternalCandidates(candidates, now, tx)),
    });
  } finally {
    await lease.release();
  }
} catch (error) {
  logger.error({ err: error }, "Manual external candidate ingestion failed");
  process.exitCode = 1;
}