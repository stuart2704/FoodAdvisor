import { db, homepageViewEventsTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/homepage-metrics", adminOnly, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const [metrics] = await db
      .select({
        loads: sql<number>`count(*)`.mapWith(Number),
        loadsToday: sql<number>`count(*) filter (
          where ${homepageViewEventsTable.createdAt} >= now() - interval '24 hours'
        )`.mapWith(Number),
        averageFeatured:
          sql<number>`coalesce(avg(${homepageViewEventsTable.featuredCount}), 0)`.mapWith(Number),
        averageTrending:
          sql<number>`coalesce(avg(${homepageViewEventsTable.trendingCount}), 0)`.mapWith(Number),
        averagePremium:
          sql<number>`coalesce(avg(${homepageViewEventsTable.premiumCount}), 0)`.mapWith(Number),
        averageDiscovery:
          sql<number>`coalesce(avg(${homepageViewEventsTable.discoveryCount}), 0)`.mapWith(Number),
      })
      .from(homepageViewEventsTable)
      .where(gte(homepageViewEventsTable.createdAt, since));
    const homepageMetrics = {
      periodDays: 7,
      loads: metrics?.loads ?? 0,
      loadsToday: metrics?.loadsToday ?? 0,
      averageFeatured: Number((metrics?.averageFeatured ?? 0).toFixed(1)),
      averageTrending: Number((metrics?.averageTrending ?? 0).toFixed(1)),
      averagePremium: Number((metrics?.averagePremium ?? 0).toFixed(1)),
      averageDiscovery: Number((metrics?.averageDiscovery ?? 0).toFixed(1)),
      generatedAt: new Date().toISOString(),
    };
    res.json({
      success: true,
      metrics: homepageMetrics,
      ...homepageMetrics,
    });
  } catch (error) {
    req.log.error({ err: error }, "Homepage metrics query failed");
    res.status(503).json({
      success: false,
      error: "Homepage metrics are temporarily unavailable.",
    });
  }
});

export default router;