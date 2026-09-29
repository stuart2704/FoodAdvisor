import cron from "node-cron";
import { logger } from "../lib/logger";
import { checkPaidCheckoutAlerts } from "../services/stripeCheckoutMonitor";

let running = false;
export function startStripeCheckoutAlertScheduler() {
  const run = async () => {
    if (running) return;
    running = true;
    try { await checkPaidCheckoutAlerts(); }
    catch (error) { logger.error({ err: error }, "Paid checkout alert scan failed"); }
    finally { running = false; }
  };
  const task = cron.schedule("*/5 * * * *", () => void run(), { noOverlap: true });
  void run();
  return task;
}