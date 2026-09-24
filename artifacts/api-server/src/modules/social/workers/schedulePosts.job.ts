import { and, eq, isNull } from "drizzle-orm";
import { db, socialPostsTable, socialSchedulesTable } from "@workspace/db";
export async function schedulePostsJob(now = new Date()): Promise<void> {
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true") return;
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const schedules = await db.select().from(socialSchedulesTable).where(and(eq(socialSchedulesTable.enabled, true), eq(socialSchedulesTable.frequency, "daily"), eq(socialSchedulesTable.timeOfDay, hhmm)));
  for (const s of schedules) {
    const scope = s.restaurantId === null ? isNull(socialPostsTable.restaurantId) : eq(socialPostsTable.restaurantId, s.restaurantId);
    const [draft] = await db.select({ id: socialPostsTable.id }).from(socialPostsTable).where(and(scope, eq(socialPostsTable.platform, s.platform), eq(socialPostsTable.status, "draft"))).limit(1);
    if (draft) await db.update(socialPostsTable).set({ status: "scheduled", scheduledFor: now, updatedAt: now }).where(and(eq(socialPostsTable.id, draft.id), eq(socialPostsTable.status, "draft")));
  }
}