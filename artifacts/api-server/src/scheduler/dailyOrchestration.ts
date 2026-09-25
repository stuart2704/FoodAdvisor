import cron, { type ScheduledTask } from "node-cron";
import { orchestrationSummary } from "../external/orchestrationSummary";
import { logger } from "../lib/logger";

let task: ScheduledTask | undefined;

/** Read-only advisory status check; does not start ingestion or reroute traffic. */
export function startDailyOrchestrationScheduler(): void {
  if (task) return;
  task = cron.schedule("5 3 * * *", async () => {
    try {
      const summary = await orchestrationSummary();
      logger.info(
        {
          health: summary.health,
          clusters: {
            eu: summary.clusters.eu.status,
            us: summary.clusters.us.status,
            apac: summary.clusters.apac.status,
          },
          suppressedRegions: summary.suppressedRegions,
        },
        "Daily advisory orchestration status checked",
      );
    } catch (err) {
      logger.error({ err }, "Daily advisory orchestration check failed");
    }
  }, {
    timezone: "Etc/UTC",
    noOverlap: true,
    name: "daily-orchestration-status",
  });
  logger.info("Advisory orchestration status check scheduled daily at 03:05 UTC.");
}