import { cityPageViewEventsTable, db } from "@workspace/db";
import { desc, gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/city-metrics", adminOnly, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const [[summary], topCities] = await Promise.all([
      db
        .select({
          views: sql<number>`count(*)`.mapWith(Number),
          viewsToday: sql<number>`count(*) filter (
            where ${cityPageViewEventsTable.createdAt} >= now() - interval '24 hours'
          )`.mapWith(Number),
          averageRestaurants:
            sql<number>`coalesce(avg(${cityPageViewEventsTable.restaurantCount}), 0)`.mapWith(Number),
        })
        .from(cityPageViewEventsTable)
        .where(gte(cityPageViewEventsTable.createdAt, since)),
      db
        .select({
          city: cityPageViewEventsTable.city,
          views: sql<number>`count(*)`.mapWith(Number),
        })
        .from(cityPageViewEventsTable)
        .where(gte(cityPageViewEventsTable.createdAt, since))
        .groupBy(cityPageViewEventsTable.city)
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
      topCities,
      generatedAt: new Date().toISOString(),
    };
    res.json({
      success: true,
      metrics: topCities,
      ...metrics,
    });
  } catch (error) {
    req.log.error({ err: error }, "City metrics query failed");
    res.status(503).json({
      success: false,
      error: "City metrics are temporarily unavailable.",
    });
  }
});

export default router;