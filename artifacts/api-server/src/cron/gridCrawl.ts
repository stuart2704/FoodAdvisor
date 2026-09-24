import cron from "node-cron";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getGridRuntimeState } from "../lib/gridCrawlRuntime";
import { logger } from "../lib/logger";
import { runDailyCrawl } from "../scripts/gridCrawl";

let running = false;

export function startGridCrawlScheduler(): void {
  cron.schedule("0 4 * * *", async () => {
    if (running) return;
    running = true;
    try {
      const state = await getGridRuntimeState();
      if (!state.automation_enabled) return;
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
  }, { timezone: "Etc/UTC" });
  logger.info("Grid crawler scheduled at 04:00 UTC; inactive until a confirmed manual point completes.");
}