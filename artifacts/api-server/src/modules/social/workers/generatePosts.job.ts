import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, restaurantsTable, socialPostsTable, socialSchedulesTable, socialSettingsTable } from "@workspace/db";
import { generateRestaurantPost, generateBrandPost } from "../ai.service";
import { getSocialSettings, SOCIAL_SETTINGS_ID } from "../settings";
export async function generatePostsJob(now = new Date()): Promise<void> {
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true") return;
  if (!(await getSocialSettings()).automation) return;
  const schedules = await db.select().from(socialSchedulesTable).where(eq(socialSchedulesTable.enabled, true));
  for (const schedule of schedules) {
    const [hour, minute] = schedule.timeOfDay.split(":").map(Number);
    if (schedule.frequency !== "daily" || now.getUTCHours() !== hour || now.getUTCMinutes() !== minute) continue;
    const existing = schedule.restaurantId === null
      ? await db.select().from(socialPostsTable).where(and(isNull(socialPostsTable.restaurantId), eq(socialPostsTable.platform, schedule.platform), eq(socialPostsTable.status, "draft")))
      : await db.select().from(socialPostsTable).where(and(eq(socialPostsTable.restaurantId, schedule.restaurantId), eq(socialPostsTable.platform, schedule.platform), eq(socialPostsTable.status, "draft")));
    if (existing.length) continue;
    const [r] = schedule.restaurantId ? await db.select().from(restaurantsTable).where(eq(restaurantsTable.placeId, schedule.restaurantId)) : [];
    if (schedule.restaurantId && !r) throw new Error(`Restaurant ${schedule.restaurantId} not found.`);
    const generated = r ? await generateRestaurantPost({ placeId: r.placeId, name: r.name, city: r.city, cuisine: r.cuisines?.join(", ") ?? r.cuisineTags?.join(", "), rating: r.rating }) : await generateBrandPost();
    await db.transaction(async (tx) => {
      const [settings] = await tx.select({ automation: socialSettingsTable.automation })
        .from(socialSettingsTable).where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID))
        .limit(1).for("update");
      if (!settings?.automation) return;
      const [active] = await tx.select({ id: socialSchedulesTable.id }).from(socialSchedulesTable)
        .where(and(eq(socialSchedulesTable.id, schedule.id), eq(socialSchedulesTable.enabled, true)))
        .limit(1).for("update");
      if (!active) return;
      await tx.insert(socialPostsTable).values({ id: randomUUID(), restaurantId: schedule.restaurantId, platform: schedule.platform, content: generated.caption, mediaUrl: generated.media, status: "draft", idempotencyKey: `${schedule.id}:${now.toISOString().slice(0, 10)}` }).onConflictDoNothing({ target: socialPostsTable.idempotencyKey });
    });
  }
}