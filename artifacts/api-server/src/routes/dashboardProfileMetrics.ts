import {
  db,
  restaurantProfileViewEventsTable,
  restaurantsTable,
} from "@workspace/db";
import { desc, eq, gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/profile-metrics", adminOnly, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const [[summary], topRestaurants] = await Promise.all([
      db
        .select({
          views: sql<number>`count(*)`.mapWith(Number),
          viewsToday: sql<number>`count(*) filter (
            where ${restaurantProfileViewEventsTable.createdAt} >= now() - interval '24 hours'
          )`.mapWith(Number),
          premiumViews: sql<number>`count(*) filter (
            where ${restaurantProfileViewEventsTable.premium}
          )`.mapWith(Number),
          unclaimedViews: sql<number>`count(*) filter (
            where not ${restaurantProfileViewEventsTable.claimed}
          )`.mapWith(Number),
        })
        .from(restaurantProfileViewEventsTable)
        .where(gte(restaurantProfileViewEventsTable.createdAt, since)),
      db
        .select({
          placeId: restaurantProfileViewEventsTable.placeId,
          name: restaurantsTable.name,
          city: restaurantsTable.city,
          views: sql<number>`count(*)`.mapWith(Number),
        })
        .from(restaurantProfileViewEventsTable)
        .innerJoin(
          restaurantsTable,
          eq(
            restaurantsTable.placeId,
            restaurantProfileViewEventsTable.placeId,
          ),
        )
        .where(gte(restaurantProfileViewEventsTable.createdAt, since))
        .groupBy(
          restaurantProfileViewEventsTable.placeId,
          restaurantsTable.name,
          restaurantsTable.city,
        )
        .orderBy(desc(sql<number>`count(*)`))
        .limit(8),
    ]);
    const metrics = {
      periodDays: 7,
      views: summary?.views ?? 0,
      viewsToday: summary?.viewsToday ?? 0,
      premiumViews: summary?.premiumViews ?? 0,
      unclaimedViews: summary?.unclaimedViews ?? 0,
      topRestaurants,
      generatedAt: new Date().toISOString(),
    };
    res.json({
      success: true,
      metrics: topRestaurants,
      ...metrics,
    });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant profile metrics query failed");
    res.status(503).json({
      success: false,
      error: "Restaurant profile metrics are temporarily unavailable.",
    });
  }
});

export default router;