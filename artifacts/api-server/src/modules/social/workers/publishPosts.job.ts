import { and, eq, lt, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, socialLogsTable, socialPostsTable } from "@workspace/db";
import { logger } from "../../../lib/logger";
import { publishPost } from "../services/publishing.service";
import { getSocialSettings } from "../settings";
import { missedUtcDay, utcDayStart } from "./dueSlot";
export async function publishPostsJob(now = new Date()): Promise<void> {
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true"
    || process.env.SOCIAL_EXTERNAL_SCHEDULER_VERIFIED !== "true") return;
  if (!(await getSocialSettings()).automation) {
    logger.info("Social automation disabled; skipping publish.");
    return;
  }
  const posts = await db.select({ id: socialPostsTable.id, scheduledFor: socialPostsTable.scheduledFor })
    .from(socialPostsTable).where(and(eq(socialPostsTable.status, "scheduled"), lte(socialPostsTable.scheduledFor, now)));
  for (const post of posts) {
    if (post.scheduledFor && missedUtcDay(post.scheduledFor, now)) {
      // Old content must not be swept into a new day's automatic run.
      // Failed rows stay visible for review and cannot be reassigned as drafts.
      const message = "Missed its UTC publishing day. Review this post and the Facebook Page before creating a new schedule.";
      await db.transaction(async (tx) => {
        const [missed] = await tx.update(socialPostsTable)
          .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
          .where(and(eq(socialPostsTable.id, post.id), eq(socialPostsTable.status, "scheduled"),
            lt(socialPostsTable.scheduledFor, utcDayStart(now))))
          .returning();
        if (missed) await tx.insert(socialLogsTable).values({
          id: randomUUID(), postId: missed.id, accountId: null,
          restaurantId: missed.restaurantId, platform: missed.platform,
          event: "schedule", status: "failed", message, attemptCount: missed.attemptCount,
        });
      });
      continue;
    }
    try {
      await publishPost(post.id, { scheduledOnly: true });
    } catch (error) {
      const message = error instanceof Error && (
        error.message === "No connected social account for this post."
        || error.message === "Publishing to this platform is not supported yet."
        || error.message === "Approved chef photo is no longer available. Review this draft before publishing."
      ) ? error.message : null;
      if (!message) {
        // The publishing service records provider failures and leaves uncertain
        // persistence outcomes unclaimed. Never submit the same post again here.
        logger.error({ postId: post.id }, "Social publish attempt did not finish; inspect post status.");
        continue;
      }
      await db.transaction(async (tx) => {
        const [failed] = await tx.update(socialPostsTable)
          .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
          .where(and(eq(socialPostsTable.id, post.id), eq(socialPostsTable.status, "scheduled")))
          .returning();
        if (failed) await tx.insert(socialLogsTable).values({
          id: randomUUID(), postId: failed.id, accountId: null,
          restaurantId: failed.restaurantId, platform: failed.platform,
          event: "publish", status: "failed", message, attemptCount: failed.attemptCount,
        });
      });
    }
  }
}