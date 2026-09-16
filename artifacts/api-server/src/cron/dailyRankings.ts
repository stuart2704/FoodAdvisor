import cron from "node-cron";
import updateRankings from "../automation/updateRankings";
import { logger } from "../lib/logger";

let running = false;

export function startDailyRankingScheduler(): void {
  cron.schedule("0 3 * * *", async () => {
    if (running) {
      logger.warn("Daily ranking update skipped because the previous run is active.");
      return;
    }
    running = true;
    try {
      const result = await updateRankings();
      logger.info(
        { updated: result.updated },
        "Daily restaurant rankings updated.",
      );
    } catch (error) {
      logger.error({ err: error }, "Daily restaurant ranking update failed.");
    } finally {
      running = false;
    }
  });
  logger.info(
    { runTime: "03:00" },
    "Daily ranking update scheduled in local server time.",
  );
}