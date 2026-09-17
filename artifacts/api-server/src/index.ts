import app from "./app";
import { logger } from "./lib/logger";
import { startWatchRenewal } from "./cron/watchRenewal";
import { startWatchHealthCheck } from "./cron/watchHealthCheck";
import { startDailyOutreachScheduler } from "./cron/dailyOutreach";
import { initializeStripe } from "./services/stripeClient";
import { startDailyRankingScheduler } from "./cron/dailyRankings";
import { startAnalyticsRollupScheduler } from "./cron/analyticsRollup";
import { startGlobalMetricsScheduler } from "./cron/globalMetrics";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startWatchRenewal();
  startWatchHealthCheck();
  startDailyOutreachScheduler();
  startDailyRankingScheduler();
  startAnalyticsRollupScheduler();
  startGlobalMetricsScheduler();
  void initializeStripe().then(
    () => logger.info("Stripe access initialized."),
    (error) =>
      logger.error({ err: error }, "Stripe access initialization failed."),
  );
});
