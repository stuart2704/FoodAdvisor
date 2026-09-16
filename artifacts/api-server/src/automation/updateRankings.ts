import { db, restaurantsTable } from "@workspace/db";
import { asc, eq, gt } from "drizzle-orm";
import { calculateRanking } from "../services/rankingEngine";

const BATCH_SIZE = 250;

export default async function updateRankings(): Promise<{ updated: number }> {
  let updated = 0;
  let cursor: string | null = null;

  while (true) {
    const restaurants = await db
      .select()
      .from(restaurantsTable)
      .where(cursor ? gt(restaurantsTable.placeId, cursor) : undefined)
      .orderBy(asc(restaurantsTable.placeId))
      .limit(BATCH_SIZE);
    if (restaurants.length === 0) break;

    const rankingUpdatedAt = new Date();
    await db.transaction(async (tx) => {
      for (const restaurant of restaurants) {
        const rankingScore = calculateRanking({
          premium: restaurant.premium,
          score: restaurant.qualificationScore,
          popularity: restaurant.popularity,
          aiRelevanceBoost: restaurant.aiRelevanceBoost,
          city: restaurant.city,
          country: "United Kingdom",
          cuisine: restaurant.cuisineTags[0] ?? null,
        });
        await tx
          .update(restaurantsTable)
          .set({ rankingScore, rankingUpdatedAt })
          .where(eq(restaurantsTable.placeId, restaurant.placeId));
      }
    });
    updated += restaurants.length;
    cursor = restaurants.at(-1)?.placeId ?? cursor;
    if (restaurants.length < BATCH_SIZE) break;
  }
  return { updated };
}