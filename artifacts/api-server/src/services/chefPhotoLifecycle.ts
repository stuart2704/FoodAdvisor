import { db, chefPhotoDeletionQueueTable, restaurantChefProfilesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

type ChefValues = typeof restaurantChefProfilesTable.$inferInsert;

// Serialize profile changes for one restaurant, including creation after deletion.
async function lockRestaurant(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], restaurantId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`chef-profile:${restaurantId}`}, 72))`);
}

export async function saveChefProfile(
  restaurantId: string,
  buildValues: (existing: typeof restaurantChefProfilesTable.$inferSelect | undefined) => ChefValues,
) {
  return db.transaction(async (tx) => {
    await lockRestaurant(tx, restaurantId);
    const [existing] = await tx.select().from(restaurantChefProfilesTable)
      .where(eq(restaurantChefProfilesTable.restaurantId, restaurantId)).limit(1);
    const values = buildValues(existing);
    if (values.photoObjectPath && values.photoObjectPath !== existing?.photoObjectPath) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`chef-photo:${values.photoObjectPath}`}, 72))`);
    }
    const [profile] = existing
      ? await tx.update(restaurantChefProfilesTable).set(values).where(eq(restaurantChefProfilesTable.restaurantId, restaurantId)).returning()
      : await tx.insert(restaurantChefProfilesTable).values(values).returning();
    if (existing?.photoObjectPath && existing.photoObjectPath !== profile.photoObjectPath) {
      await tx.insert(chefPhotoDeletionQueueTable).values({ objectPath: existing.photoObjectPath, dueAt: new Date(Date.now() + 20 * 60_000) })
        .onConflictDoNothing();
    }
    return profile;
  });
}

export async function removeChefProfile(restaurantId: string) {
  await db.transaction(async (tx) => {
    await lockRestaurant(tx, restaurantId);
    const [existing] = await tx.delete(restaurantChefProfilesTable)
      .where(eq(restaurantChefProfilesTable.restaurantId, restaurantId)).returning({ photoObjectPath: restaurantChefProfilesTable.photoObjectPath });
    if (existing?.photoObjectPath) {
      await tx.insert(chefPhotoDeletionQueueTable).values({ objectPath: existing.photoObjectPath, dueAt: new Date(Date.now() + 20 * 60_000) })
        .onConflictDoNothing();
    }
  });
}