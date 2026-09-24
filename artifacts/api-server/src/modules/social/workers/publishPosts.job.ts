import { and, eq, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, socialLogsTable, socialPostsTable } from "@workspace/db";
import { logger } from "../../../lib/logger";
import { publishPost } from "../services/publishing.service";
import { getSocialSettings } from "../settings";
export async function publishPostsJob(now = new Date()): Promise<void> {
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true") return;
  if (!(await getSocialSettings()).automation) {
    logger.info("Social automation disabled; skipping publish.");
    return;
  }
  const posts = await db.select({ id: socialPostsTable.id }).from(socialPostsTable).where(and(eq(socialPostsTable.status, "scheduled"), lte(socialPostsTable.scheduledFor, now)));
  for (const post of posts) {
    try {
      await publishPost(post.id, { scheduledOnly: true });
    } catch (error) {
      const message = error instanceof Error && (
        error.message === "No connected social account for this post."
        || error.message === "Publishing to this platform is not supported yet."
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