import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, restaurantsTable, socialLogsTable, socialPostsTable, socialSchedulesTable, socialSettingsTable } from "@workspace/db";
import { generateRestaurantPost, generateBrandPost } from "../ai.service";
import { getSocialSettings, SOCIAL_SETTINGS_ID } from "../settings";
import { assignedToday, dueSlotToday } from "./dueSlot";
export async function generatePostsJob(now = new Date()): Promise<void> {
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true"
    || process.env.SOCIAL_EXTERNAL_SCHEDULER_VERIFIED !== "true") return;
  if (!(await getSocialSettings()).automation) return;
  const schedules = await db.select().from(socialSchedulesTable).where(eq(socialSchedulesTable.enabled, true));
  for (const schedule of schedules) {
    if (schedule.frequency !== "daily" || !dueSlotToday(schedule.timeOfDay, now)
      || assignedToday(schedule.lastAssignedAt, now) || !["facebook", "instagram", "tiktok"].includes(schedule.platform)
      || (!schedule.restaurantId && schedule.platform !== "facebook")) continue;
    const existing = schedule.restaurantId === null
      ? await db.select().from(socialPostsTable).where(and(isNull(socialPostsTable.restaurantId), eq(socialPostsTable.platform, schedule.platform), eq(socialPostsTable.status, "draft")))
      : await db.select().from(socialPostsTable).where(and(eq(socialPostsTable.restaurantId, schedule.restaurantId), eq(socialPostsTable.platform, schedule.platform), eq(socialPostsTable.status, "draft")));
    if (existing.length) continue;
    const started = Date.now();
    try {
    const [r] = schedule.restaurantId ? await db.select().from(restaurantsTable).where(eq(restaurantsTable.placeId, schedule.restaurantId)) : [];
    if (schedule.restaurantId && (!r || !r.published)) throw new Error(`Published restaurant ${schedule.restaurantId} not found.`);
    // Listing cuisine tags can be inferred; only use published name/city and approved chef facts.
    const generated = r ? await generateRestaurantPost({ placeId: r.placeId, name: r.name, city: r.city }, Math.floor(now.getTime() / 86_400_000)) : await generateBrandPost();
    await db.transaction(async (tx) => {
      const [settings] = await tx.select({ automation: socialSettingsTable.automation })
        .from(socialSettingsTable).where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID))
        .limit(1).for("update");
      if (!settings?.automation) return;
      const [active] = await tx.select({ id: socialSchedulesTable.id }).from(socialSchedulesTable)
        .where(and(eq(socialSchedulesTable.id, schedule.id), eq(socialSchedulesTable.enabled, true)))
        .limit(1).for("update");
      if (!active) return;
      const [post] = await tx.insert(socialPostsTable).values({ id: randomUUID(), restaurantId: schedule.restaurantId, platform: schedule.platform, content: generated.caption, mediaObjectPath: generated.mediaObjectPath, status: "draft", idempotencyKey: `${schedule.id}:${now.toISOString().slice(0, 10)}` }).onConflictDoNothing({ target: socialPostsTable.idempotencyKey }).returning({ id: socialPostsTable.id });
      if (post) await tx.insert(socialLogsTable).values({ id: randomUUID(), postId: post.id, restaurantId: schedule.restaurantId, platform: schedule.platform, event: "generate", status: "success", durationMs: Date.now() - started });
    });
    } catch (error) {
      await db.insert(socialLogsTable).values({ id: randomUUID(), restaurantId: schedule.restaurantId, platform: schedule.platform, event: "generate", status: "failed", message: "Automated draft generation failed.", durationMs: Date.now() - started });
      throw error;
    }
  }
}