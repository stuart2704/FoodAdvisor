import { sql } from "drizzle-orm";
import { db, socialSchedulesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { generatePostsJob } from "../modules/social/workers/generatePosts.job";
import { schedulePostsJob } from "../modules/social/workers/schedulePosts.job";
import { publishPostsJob } from "../modules/social/workers/publishPosts.job";

// A transaction-scoped lock is released even when a replica dies midway through
// the cycle. Per-post "publishing" claims are deliberately NOT released: after
// a provider request its outcome may be unknown and must be reconciled manually.
export async function runSocialAutomationCycle(now = new Date()): Promise<"ran" | "busy"> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(864293, 1) as acquired`,
    );
    if (!lock.rows[0]?.acquired) return "busy";
    // Even a master-OFF verification run must fail if the deployed schema
    // cannot support daily assignment; otherwise a green probe is misleading.
    await tx.select({ lastAssignedAt: socialSchedulesTable.lastAssignedAt })
      .from(socialSchedulesTable).limit(1);
    let firstError: unknown;
    try {
      await generatePostsJob(now);
    } catch (err) {
      firstError = err;
      logger.error({ err }, "Social post generation failed; continuing with due posts.");
    }
    try {
      await schedulePostsJob(now);
    } catch (err) {
      firstError ??= err;
      logger.error({ err }, "Social post assignment failed; continuing with already scheduled posts.");
    }
    await publishPostsJob(now);
    if (firstError) throw firstError;
    return "ran";
  });
}