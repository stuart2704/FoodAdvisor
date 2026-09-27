import app from "./app";
import { logger } from "./lib/logger";
import { startWatchRenewal } from "./cron/watchRenewal";
import { startWatchHealthCheck } from "./cron/watchHealthCheck";
import { startDailyOutreachScheduler } from "./cron/dailyOutreach";
import { initializeStripe } from "./services/stripeClient";
import { startDailyRankingScheduler } from "./cron/dailyRankings";
import { startAnalyticsRollupScheduler } from "./cron/analyticsRollup";
import { startGlobalMetricsScheduler } from "./cron/globalMetrics";
import { startOperationalLogCleanup } from "./cron/operationalLogCleanup";
import { startAiDescriptionCacheCleanup } from "./cron/aiDescriptionCacheCleanup";
import { startBetterContactScheduler } from "./cron/betterContact";
import { startExternalIngestionScheduler } from "./cron/scheduler";
import { startDailyOrchestrationScheduler } from "./scheduler/dailyOrchestration";
import { startChefPhotoCleanup } from "./cron/chefPhotoCleanup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void initializeAfterListen();
});

async function initializeAfterListen(): Promise<void> {
  startWatchRenewal();
  startWatchHealthCheck();
  startDailyOutreachScheduler();
  startDailyRankingScheduler();
  startAnalyticsRollupScheduler();
  startGlobalMetricsScheduler();
  startOperationalLogCleanup();
  startAiDescriptionCacheCleanup();
  startBetterContactScheduler();
  startExternalIngestionScheduler();
  startDailyOrchestrationScheduler();
  startChefPhotoCleanup();

  try {
    await initializeStripe();
    logger.info("Stripe access, managed webhook, and catalog sync initialized.");
  } catch (err) {
    logger.error(
      { err },
      "Stripe initialization failed; payment routes remain unavailable.",
    );
  }
}
