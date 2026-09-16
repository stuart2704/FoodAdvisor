import { cuisinePageViewEventsTable, db } from "@workspace/db";
import { desc, gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/cuisine-metrics", adminOnly, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const [[summary], topCuisines] = await Promise.all([
      db
        .select({
          views: sql<number>`count(*)`.mapWith(Number),
          viewsToday: sql<number>`count(*) filter (
            where ${cuisinePageViewEventsTable.createdAt} >= now() - interval '24 hours'
          )`.mapWith(Number),
          averageRestaurants:
            sql<number>`coalesce(avg(${cuisinePageViewEventsTable.restaurantCount}), 0)`.mapWith(Number),
        })
        .from(cuisinePageViewEventsTable)
        .where(gte(cuisinePageViewEventsTable.createdAt, since)),
      db
        .select({
          cuisine: cuisinePageViewEventsTable.cuisine,
          views: sql<number>`count(*)`.mapWith(Number),
        })
        .from(cuisinePageViewEventsTable)
        .where(gte(cuisinePageViewEventsTable.createdAt, since))
        .groupBy(cuisinePageViewEventsTable.cuisine)
        .orderBy(desc(sql<number>`count(*)`))
        .limit(8),
    ]);
    const metrics = {
      periodDays: 7,
      views: summary?.views ?? 0,
      viewsToday: summary?.viewsToday ?? 0,
      averageRestaurants: Number(
        (summary?.averageRestaurants ?? 0).toFixed(1),
      ),
      topCuisines,
      generatedAt: new Date().toISOString(),
    };
    res.json({
      success: true,
      metrics: topCuisines,
      ...metrics,
    });
  } catch (error) {
    req.log.error({ err: error }, "Cuisine metrics query failed");
    res.status(503).json({
      success: false,
      error: "Cuisine metrics are temporarily unavailable.",
    });
  }
});

export default router;