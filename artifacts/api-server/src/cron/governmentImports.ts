import cron from "node-cron";
import { logger } from "../lib/logger";
import { PUBLIC_SOURCES, runGovernmentSource } from "../governmentSources/importer";

let task: ReturnType<typeof cron.schedule> | undefined;
export function startGovernmentImportScheduler() {
  if (task || process.env.NODE_ENV !== "production") return;
  task = cron.schedule("30 2 * * *", async () => {
    for (const source of PUBLIC_SOURCES) {
      try {
        const result = await runGovernmentSource(source);
        if (result.status !== "blocked") logger.info({ source, result }, "Government import result");
      } catch (err) {
        logger.error({ source, err }, "Government import failed closed");
      }
    }
  }, { timezone: "Etc/UTC", noOverlap: true, name: "government-imports" });
}