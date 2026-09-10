import cron from "node-cron";
import { db, gmailWatchStateTable } from "@workspace/db";
import { renewGmailWatch } from "../services/gmailWatch";
import { sendAlert } from "../utils/alert";
import { logger } from "../lib/logger";

let task: ReturnType<typeof cron.schedule> | undefined;

export async function checkWatchHealth(): Promise<void> {
  logger.info("Running Gmail watch health check.");
  try {
    const rows = await db.select().from(gmailWatchStateTable).limit(2);
    if (rows.length > 1) {
      throw new Error("Multiple Gmail watch accounts require investigation.");
    }
    const status = rows[0];
    // Database dates and Gmail expiration values use milliseconds, not seconds.
    const hoursLeft = status
      ? (status.watchExpiration.getTime() - Date.now()) / 3_600_000
      : null;
    if (hoursLeft === null || !Number.isFinite(hoursLeft) || hoursLeft < 24) {
      logger.info(
        { hoursLeft },
        "Gmail watch is missing or nearing expiration; renewing.",
      );
      await renewGmailWatch();
    }
  } catch {
    await sendAlert(
      "Gmail watch renewal failed — manual intervention required.",
    );
  }
}

export function startWatchHealthCheck() {
  if (task || process.env.GMAIL_WATCH_HEALTH_CHECK_ENABLED !== "true") return task;
  // In-process timers require an always-running deployment.
  task = cron.schedule("0 * * * *", checkWatchHealth, {
    noOverlap: true,
    name: "gmail-watch-health-check",
  });
  logger.info("Gmail watch health check scheduled hourly.");
  return task;
}

export async function stopWatchHealthCheck() {
  if (task) {
    await task.destroy();
    task = undefined;
  }
}