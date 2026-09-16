import cron from "node-cron";
import analyticsRollup from "../automation/analyticsRollup";
import { logger } from "../lib/logger";

let running = false;

export function startAnalyticsRollupScheduler(): void {
  cron.schedule("0 1 * * *", async () => {
    if (running) {
      logger.warn("Analytics rollup skipped because the previous run is active.");
      return;
    }
    running = true;
    try {
      const result = await analyticsRollup();
      logger.info({ date: result.date }, "Daily analytics rollup completed.");
    } catch (error) {
      logger.error({ err: error }, "Daily analytics rollup failed.");
    } finally {
      running = false;
    }
  });
  logger.info(
    { runTime: "01:00" },
    "Daily analytics rollup scheduled in local server time.",
  );
}