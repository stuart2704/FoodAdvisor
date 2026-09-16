import { db, restaurantSearchEventsTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/search-metrics", adminOnly, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const [metrics] = await db
      .select({
        searches: sql<number>`count(*)`.mapWith(Number),
        searchesToday: sql<number>`count(*) filter (
          where ${restaurantSearchEventsTable.createdAt} >= now() - interval '24 hours'
        )`.mapWith(Number),
        zeroResultSearches: sql<number>`count(*) filter (
          where ${restaurantSearchEventsTable.resultCount} = 0
        )`.mapWith(Number),
        aiSearches: sql<number>`count(*) filter (
          where ${restaurantSearchEventsTable.aiRequested}
        )`.mapWith(Number),
        aiScoredRestaurants:
          sql<number>`coalesce(sum(${restaurantSearchEventsTable.aiScoredCount}), 0)`.mapWith(Number),
        averageResults:
          sql<number>`coalesce(avg(${restaurantSearchEventsTable.resultCount}), 0)`.mapWith(Number),
        averageDurationMs:
          sql<number>`coalesce(avg(${restaurantSearchEventsTable.durationMs}), 0)`.mapWith(Number),
      })
      .from(restaurantSearchEventsTable)
      .where(gte(restaurantSearchEventsTable.createdAt, since));
    const searches = metrics?.searches ?? 0;
    const zeroResultSearches = metrics?.zeroResultSearches ?? 0;
    res.json({
      success: true,
      periodDays: 7,
      searches,
      searchesToday: metrics?.searchesToday ?? 0,
      zeroResultSearches,
      zeroResultRate:
        searches > 0 ? Number(((zeroResultSearches / searches) * 100).toFixed(1)) : 0,
      aiSearches: metrics?.aiSearches ?? 0,
      aiScoredRestaurants: metrics?.aiScoredRestaurants ?? 0,
      averageResults: Number((metrics?.averageResults ?? 0).toFixed(1)),
      averageDurationMs: Math.round(metrics?.averageDurationMs ?? 0),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ err: error }, "Search metrics query failed");
    res.status(503).json({
      success: false,
      error: "Search metrics are temporarily unavailable.",
    });
  }
});

export default router;