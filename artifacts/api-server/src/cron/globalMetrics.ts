import cron from "node-cron";
import updateGlobalMetrics from "../automation/globalMetrics";
import { logger } from "../lib/logger";
import { recordHeartbeat } from "../services/engineHeartbeat";

let running = false;

export function startGlobalMetricsScheduler(): void {
  cron.schedule("*/30 * * * *", async () => {
    if (running) {
      logger.warn("Global metrics snapshot skipped because the previous run is active.");
      return;
    }
    running = true;
    try {
      const metrics = await updateGlobalMetrics();
      await recordHeartbeat("queue");
      logger.info(
        { updatedAt: metrics.updatedAt },
        "Global metrics snapshot recorded.",
      );
    } catch (error) {
      logger.error({ err: error }, "Global metrics snapshot failed.");
    } finally {
      running = false;
    }
  });
  logger.info(
    { schedule: "*/30 * * * *" },
    "Global metrics snapshots scheduled every 30 minutes.",
  );
}