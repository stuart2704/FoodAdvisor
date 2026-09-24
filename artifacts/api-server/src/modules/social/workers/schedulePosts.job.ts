import { and, eq, isNull } from "drizzle-orm";
import { db, socialPostsTable, socialSchedulesTable } from "@workspace/db";
export async function schedulePostsJob(now = new Date()): Promise<void> {
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true") return;
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const schedules = await db.select().from(socialSchedulesTable).where(and(eq(socialSchedulesTable.enabled, true), eq(socialSchedulesTable.frequency, "daily"), eq(socialSchedulesTable.timeOfDay, hhmm)));
  for (const s of schedules) {
    await db.transaction(async (tx) => {
      // Share the schedule row lock with the admin OFF action; after OFF commits
      // a stale worker selection cannot turn a brand draft back into a due post.
      const [active] = await tx.select({ id: socialSchedulesTable.id }).from(socialSchedulesTable)
        .where(and(eq(socialSchedulesTable.id, s.id), eq(socialSchedulesTable.enabled, true)))
        .limit(1).for("update");
      if (!active) return;
      const scope = s.restaurantId === null ? isNull(socialPostsTable.restaurantId) : eq(socialPostsTable.restaurantId, s.restaurantId);
      const [draft] = await tx.select({ id: socialPostsTable.id }).from(socialPostsTable)
        .where(and(scope, eq(socialPostsTable.platform, s.platform), eq(socialPostsTable.status, "draft"))).limit(1);
      if (draft) await tx.update(socialPostsTable)
        .set({ status: "scheduled", scheduledFor: now, updatedAt: now })
        .where(and(eq(socialPostsTable.id, draft.id), eq(socialPostsTable.status, "draft")));
    });
  }
}