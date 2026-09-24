import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../lib/logger";
import { generatePostsJob } from "../modules/social/workers/generatePosts.job";
import { schedulePostsJob } from "../modules/social/workers/schedulePosts.job";
import { publishPostsJob } from "../modules/social/workers/publishPosts.job";

let task: ScheduledTask | undefined;

export function startSocialAutomationScheduler(): void {
  if (task || process.env.SOCIAL_AUTOMATION_ENABLED !== "true") return;
  task = cron.schedule("* * * * *", async () => {
    try {
      await generatePostsJob();
      await schedulePostsJob();
      await publishPostsJob();
    } catch (err) {
      logger.error({ err }, "Social automation cycle failed.");
    }
  }, { timezone: "UTC", noOverlap: true, name: "social-automation" });
  logger.info("Social automation worker configured; checking the master setting every minute in UTC.");
}