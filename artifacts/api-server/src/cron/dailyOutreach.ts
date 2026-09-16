import cron from "node-cron";
import outreachEngine from "../automation/outreachEngine";
import { recordSchedulerRun } from "../dashboard/schedulerState";
import { logger } from "../lib/logger";

const OUTREACH_RUN_TIME = "every 3 hours";
const OUTREACH_RUN_CRON = "0 */3 * * *";

let task: ReturnType<typeof cron.schedule> | undefined;

async function runScheduledDailyOutreach(): Promise<void> {
  const startedAt = new Date();
  logger.info("Scheduled daily outreach cycle started.");
  try {
    const result = await outreachEngine();
    const outreach =
      result.outreach.status === "completed" ? result.outreach.result : null;
    recordSchedulerRun(
      "daily-outreach",
      startedAt,
      outreach?.failed ? "failed" : "completed",
      outreach
        ? `Daily outreach finished: ${outreach.queued} queued, ${outreach.sent} confirmed sent, ${outreach.skipped} skipped, ${outreach.failed} failed.`
        : "Daily outreach cycle completed without a sending phase.",
    );
    logger.info(
      { outreach },
      "Scheduled daily outreach cycle completed.",
    );
  } catch (error) {
    recordSchedulerRun(
      "daily-outreach",
      startedAt,
      "failed",
      "Daily outreach cycle failed.",
    );
    logger.error({ err: error }, "Scheduled daily outreach cycle failed.");
  }
}

export function startDailyOutreachScheduler() {
  if (
    task ||
    process.env.DAILY_OUTREACH_SCHEDULER_ENABLED !== "true"
  ) {
    return task;
  }

  task = cron.schedule(OUTREACH_RUN_CRON, runScheduledDailyOutreach, {
    noOverlap: true,
    name: "daily-outreach",
  });
  logger.info(
    { runTime: OUTREACH_RUN_TIME, schedule: OUTREACH_RUN_CRON },
    "Outreach scheduled every three hours in local server time.",
  );
  return task;
}

export function getDailyOutreachSchedulerStatus() {
  return {
    name: "daily-outreach",
    schedule: OUTREACH_RUN_CRON,
    runTime: OUTREACH_RUN_TIME,
    timezone: "server",
    enabled: process.env.DAILY_OUTREACH_SCHEDULER_ENABLED === "true",
    running: task !== undefined,
    nextRunAt: task?.getNextRun()?.toISOString() ?? null,
  };
}

export async function stopDailyOutreachScheduler() {
  if (task) {
    await task.destroy();
    task = undefined;
  }
}