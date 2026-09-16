import { claimPageEventsTable, db } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

async function claimMetricsHandler(
  req: Parameters<typeof adminOnly>[0],
  res: Parameters<typeof adminOnly>[1],
) {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const [summary] = await db
      .select({
        views: sql<number>`count(*) filter (
          where ${claimPageEventsTable.eventType} = 'view'
        )`.mapWith(Number),
        viewsToday: sql<number>`count(*) filter (
          where ${claimPageEventsTable.eventType} = 'view'
            and ${claimPageEventsTable.createdAt} >= now() - interval '24 hours'
        )`.mapWith(Number),
        completedClaims: sql<number>`count(*) filter (
          where ${claimPageEventsTable.eventType} = 'completed'
        )`.mapWith(Number),
        alreadyClaimedViews: sql<number>`count(*) filter (
          where ${claimPageEventsTable.eventType} = 'view'
            and ${claimPageEventsTable.alreadyClaimed}
        )`.mapWith(Number),
      })
      .from(claimPageEventsTable)
      .where(gte(claimPageEventsTable.createdAt, since));
    const views = summary?.views ?? 0;
    const completedClaims = summary?.completedClaims ?? 0;
    const metrics = {
      periodDays: 7,
      views,
      viewsToday: summary?.viewsToday ?? 0,
      completedClaims,
      alreadyClaimedViews: summary?.alreadyClaimedViews ?? 0,
      conversionRate:
        views > 0 ? Number(((completedClaims / views) * 100).toFixed(1)) : 0,
      generatedAt: new Date().toISOString(),
    };
    res.json({ success: true, metrics, ...metrics });
  } catch (error) {
    req.log.error({ err: error }, "Claim page metrics query failed");
    res.status(503).json({
      success: false,
      error: "Claim page metrics are temporarily unavailable.",
    });
  }
}

router.get("/claim-metrics", adminOnly, claimMetricsHandler);
router.get("/claim-page-metrics", adminOnly, claimMetricsHandler);

export default router;