import cron from "node-cron";
import { logger } from "../lib/logger";
import { cleanupOperationalEvents } from "../services/operationalLog";

let task: ReturnType<typeof cron.schedule> | undefined;
let running = false;

async function runCleanup(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const deleted = await cleanupOperationalEvents();
    logger.info({ deleted }, "Expired operational events removed.");
  } catch (error) {
    logger.error({ err: error }, "Operational event cleanup failed.");
  } finally {
    running = false;
  }
}

export function startOperationalLogCleanup() {
  if (task) return task;
  void runCleanup();
  task = cron.schedule("0 2 * * *", () => void runCleanup(), {
    noOverlap: true,
    name: "operational-log-cleanup",
  });
  return task;
}