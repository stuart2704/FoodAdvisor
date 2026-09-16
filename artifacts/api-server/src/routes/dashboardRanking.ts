import { db, restaurantsTable } from "@workspace/db";
import { desc, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/ranking", adminOnly, async (req, res) => {
  try {
    const [[summary], topRestaurants] = await Promise.all([
      db
        .select({
          rankedRestaurants: sql<number>`count(*) filter (
            where ${restaurantsTable.rankingUpdatedAt} is not null
          )`.mapWith(Number),
          averagePremiumScore: sql<number>`coalesce(avg(
            ${restaurantsTable.rankingScore}
          ) filter (where ${restaurantsTable.premium}), 0)`.mapWith(Number),
          averageBasicScore: sql<number>`coalesce(avg(
            ${restaurantsTable.rankingScore}
          ) filter (where not ${restaurantsTable.premium}), 0)`.mapWith(Number),
          lastUpdated: sql<Date | null>`max(${restaurantsTable.rankingUpdatedAt})`,
        })
        .from(restaurantsTable),
      db
        .select({
          placeId: restaurantsTable.placeId,
          name: restaurantsTable.name,
          city: restaurantsTable.city,
          cuisine: sql<string | null>`${restaurantsTable.cuisineTags}[1]`,
          premium: restaurantsTable.premium,
          rankingScore: restaurantsTable.rankingScore,
        })
        .from(restaurantsTable)
        .where(isNotNull(restaurantsTable.rankingUpdatedAt))
        .orderBy(
          desc(restaurantsTable.rankingScore),
          restaurantsTable.name,
        )
        .limit(10),
    ]);
    const lastUpdate = summary?.lastUpdated
      ? new Date(summary.lastUpdated).toISOString()
      : null;
    const count = summary?.rankedRestaurants ?? 0;
    res.json({
      success: true,
      count,
      rankedRestaurants: count,
      averagePremiumScore: Number(
        (summary?.averagePremiumScore ?? 0).toFixed(1),
      ),
      averageBasicScore: Number((summary?.averageBasicScore ?? 0).toFixed(1)),
      lastUpdate,
      lastUpdated: lastUpdate,
      premiumBoostActive: true,
      topRestaurants,
    });
  } catch (error) {
    req.log.error({ err: error }, "Ranking dashboard query failed");
    res.status(503).json({
      success: false,
      error: "Ranking metrics are temporarily unavailable.",
    });
  }
});

export default router;