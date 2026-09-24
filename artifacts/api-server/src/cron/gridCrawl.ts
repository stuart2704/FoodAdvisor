import cron from "node-cron";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getGridRuntimeState } from "../lib/gridCrawlRuntime";
import { shouldRunScheduledGridCrawl } from "../lib/gridCrawlSchedule";
import { logger } from "../lib/logger";
import { runDailyCrawl } from "../scripts/gridCrawl";

let running = false;

async function runIfDue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const state = await getGridRuntimeState();
    if (!shouldRunScheduledGridCrawl(state, new Date())) return;
    const localGrid = resolve(process.cwd(), "coordinates.json");
    const gridFile = existsSync(localGrid)
      ? localGrid
      : resolve(process.cwd(), "artifacts/api-server/coordinates.json");
    await runDailyCrawl([
      "--grid", gridFile,
      "--state", resolve(process.cwd(), "grid-progress.json"),
      "--monthly-budget-cents", String(state.monthly_budget_cents),
      "--confirm", "--auto",
    ]);
  } catch (error) {
    logger.error({ err: error }, "Automatic grid crawl stopped; no uncertain point was retried.");
  } finally {
    running = false;
  }
}

export function startGridCrawlScheduler(): void {
  // A VM that restarts after 04:00 UTC catches up; later checks retry failures
  // before any reservation, while a same-day reservation prevents a second crawl.
  cron.schedule("0 4-23 * * *", () => void runIfDue(), { timezone: "Etc/UTC" });
  void runIfDue();
  logger.info("Grid crawler checks after 04:00 UTC and on startup; inactive until a confirmed manual point completes.");
}