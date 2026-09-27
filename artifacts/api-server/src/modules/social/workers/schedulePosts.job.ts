import { and, asc, eq, isNull } from "drizzle-orm";
import { db, socialPostsTable, socialSchedulesTable, socialSettingsTable } from "@workspace/db";
import { getSocialSettings, SOCIAL_SETTINGS_ID } from "../settings";
import { assignedToday, dueSlotToday } from "./dueSlot";
export async function schedulePostsJob(now = new Date()): Promise<void> {
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true"
    || process.env.SOCIAL_EXTERNAL_SCHEDULER_VERIFIED !== "true") return;
  if (!(await getSocialSettings()).automation) return;
  const schedules = await db.select().from(socialSchedulesTable).where(and(eq(socialSchedulesTable.enabled, true), eq(socialSchedulesTable.frequency, "daily")));
  for (const s of schedules) {
    if (!dueSlotToday(s.timeOfDay, now) || assignedToday(s.lastAssignedAt, now) || s.platform !== "facebook") continue;
    await db.transaction(async (tx) => {
      const [settings] = await tx.select({ automation: socialSettingsTable.automation })
        .from(socialSettingsTable).where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID))
        .limit(1).for("update");
      if (!settings?.automation) return;
      // Share the schedule row lock with the admin OFF action; after OFF commits
      // a stale worker selection cannot turn a brand draft back into a due post.
      const [active] = await tx.select().from(socialSchedulesTable)
        .where(and(eq(socialSchedulesTable.id, s.id), eq(socialSchedulesTable.enabled, true)))
        .limit(1).for("update");
      const slot = active && dueSlotToday(active.timeOfDay, now);
      if (!active || !slot || assignedToday(active.lastAssignedAt, now)) return;
      const scope = s.restaurantId === null ? isNull(socialPostsTable.restaurantId) : eq(socialPostsTable.restaurantId, s.restaurantId);
      const [draft] = await tx.select({ id: socialPostsTable.id }).from(socialPostsTable)
        .where(and(scope, eq(socialPostsTable.platform, active.platform), eq(socialPostsTable.status, "draft")))
        .orderBy(asc(socialPostsTable.createdAt)).limit(1);
      if (draft) {
        const [assigned] = await tx.update(socialPostsTable)
          .set({ status: "scheduled", scheduledFor: slot, updatedAt: now })
          .where(and(eq(socialPostsTable.id, draft.id), eq(socialPostsTable.status, "draft")))
          .returning({ id: socialPostsTable.id });
        if (assigned) await tx.update(socialSchedulesTable)
          .set({ lastAssignedAt: slot, updatedAt: now })
          .where(eq(socialSchedulesTable.id, active.id));
      }
    });
  }
}