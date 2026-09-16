import cron from "node-cron";
import { db, gmailWatchStateTable } from "@workspace/db";
import { renewGmailWatch } from "../services/gmailWatch";
import { logger } from "../lib/logger";
import { recordSchedulerRun } from "../dashboard/schedulerState";

let task: ReturnType<typeof cron.schedule> | undefined;

export function startWatchRenewal() {
  if (task || process.env.GMAIL_WATCH_RENEWAL_ENABLED !== "true") return task;

  // Requires an always-running server. Autoscale deployments should use an
  // external scheduler calling the protected renewal endpoint instead.
  task = cron.schedule("0 3 * * MON", async () => {
    const startedAt = new Date();
    logger.info("Weekly Gmail watch renewal started.");
    try {
      const [state] = await db.select().from(gmailWatchStateTable).limit(1);
      if (!state) {
        logger.warn("Gmail watch renewal skipped: activate the watch first.");
        recordSchedulerRun(
          "gmail-watch-renewal",
          startedAt,
          "skipped",
          "No Gmail watch is active.",
        );
        return;
      }
      await renewGmailWatch();
      recordSchedulerRun(
        "gmail-watch-renewal",
        startedAt,
        "completed",
        "Gmail watch renewal completed.",
      );
      logger.info("Weekly Gmail watch renewal completed.");
    } catch {
      recordSchedulerRun(
        "gmail-watch-renewal",
        startedAt,
        "failed",
        "Gmail watch renewal failed.",
      );
      // Do not expose raw provider errors, mailbox details, or credentials.
      logger.error("Weekly Gmail watch renewal failed; manual renewal may be required.");
    }
  }, {
    noOverlap: true,
    name: "gmail-watch-renewal",
  });
  logger.info("Gmail watch renewal scheduled Mondays at 03:00 server time.");
  return task;
}

export function getWatchRenewalSchedulerStatus() {
  return {
    name: "gmail-watch-renewal",
    schedule: "0 3 * * MON",
    timezone: "server",
    enabled: process.env.GMAIL_WATCH_RENEWAL_ENABLED === "true",
    running: task !== undefined,
    nextRunAt: task?.getNextRun()?.toISOString() ?? null,
  };
}

export async function stopWatchRenewal() {
  if (task) {
    await task.destroy();
    task = undefined;
  }
}