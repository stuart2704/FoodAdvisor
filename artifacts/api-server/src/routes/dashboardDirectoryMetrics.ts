import { db, directoryViewEventsTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/directory-metrics", adminOnly, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const [summary] = await db
      .select({
        loads: sql<number>`count(*)`.mapWith(Number),
        loadsToday: sql<number>`count(*) filter (
          where ${directoryViewEventsTable.createdAt} >= now() - interval '24 hours'
        )`.mapWith(Number),
        deeperPageLoads: sql<number>`count(*) filter (
          where ${directoryViewEventsTable.page} > 1
        )`.mapWith(Number),
        filteredLoads: sql<number>`count(*) filter (
          where ${directoryViewEventsTable.cityFiltered}
             or ${directoryViewEventsTable.cuisineFiltered}
             or ${directoryViewEventsTable.priceFiltered}
        )`.mapWith(Number),
        premiumOnlyLoads: sql<number>`count(*) filter (
          where ${directoryViewEventsTable.premiumOnly}
        )`.mapWith(Number),
        averageResults:
          sql<number>`coalesce(avg(${directoryViewEventsTable.resultCount}), 0)`.mapWith(Number),
      })
      .from(directoryViewEventsTable)
      .where(gte(directoryViewEventsTable.createdAt, since));
    const metrics = {
      periodDays: 7,
      loads: summary?.loads ?? 0,
      loadsToday: summary?.loadsToday ?? 0,
      deeperPageLoads: summary?.deeperPageLoads ?? 0,
      filteredLoads: summary?.filteredLoads ?? 0,
      premiumOnlyLoads: summary?.premiumOnlyLoads ?? 0,
      averageResults: Number((summary?.averageResults ?? 0).toFixed(1)),
      generatedAt: new Date().toISOString(),
    };
    res.json({ success: true, metrics, ...metrics });
  } catch (error) {
    req.log.error({ err: error }, "Directory metrics query failed");
    res.status(503).json({
      success: false,
      error: "Directory metrics are temporarily unavailable.",
    });
  }
});

export default router;