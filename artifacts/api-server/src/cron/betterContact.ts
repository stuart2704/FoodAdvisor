import cron from "node-cron";
import { logger } from "../lib/logger";
import { processBetterContactJobs } from "../services/enrichment/betterContact";

let task: ReturnType<typeof cron.schedule> | undefined;

export async function runBetterContactWorker(): Promise<void> {
  try {
    const processed = await processBetterContactJobs();
    if (processed > 0) logger.info({ processed }, "BetterContact jobs processed.");
  } catch (error) {
    logger.error({ err: error }, "BetterContact worker failed.");
  }
}

export function startBetterContactScheduler(): void {
  if (task) return;
  task = cron.schedule("* * * * *", () => void runBetterContactWorker(), {
    name: "better-contact",
  });
}