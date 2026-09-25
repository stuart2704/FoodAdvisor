import { runExternalCandidateIngestion } from "../cron/externalIngestion";
import { logger } from "../lib/logger";

const now = new Date();

try {
  await runExternalCandidateIngestion(now);
} catch (error) {
  logger.error({ err: error }, "Manual external candidate ingestion failed");
  process.exitCode = 1;
}