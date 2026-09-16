import { db, restaurantsTable } from "@workspace/db";
import { desc, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/claims", adminOnly, async (req, res) => {
  try {
    const [[totals], recentRows] = await Promise.all([
      db
        .select({
          completed:
            sql<number>`count(*) filter (where ${restaurantsTable.claimedAt} is not null)`.mapWith(Number),
        })
        .from(restaurantsTable),
      db
        .select({
          restaurant: restaurantsTable.name,
          occurredAt: restaurantsTable.claimedAt,
        })
        .from(restaurantsTable)
        .where(isNotNull(restaurantsTable.claimedAt))
        .orderBy(desc(restaurantsTable.claimedAt))
        .limit(50),
    ]);

    const completed = totals?.completed ?? 0;
    res.json({
      success: true,
      visits: 0,
      clicks: 0,
      completed,
      conversionRate: 0,
      byCountry: completed > 0 ? { "United Kingdom": completed } : {},
      recent: recentRows.map((event) => ({
        restaurant: event.restaurant,
        type: "completed" as const,
        occurredAt: event.occurredAt?.toISOString() ?? null,
      })),
      trackingNote:
        "Claim completions are persisted. Claim-page visits and button clicks are not currently tracked.",
    });
  } catch (error) {
    req.log.error({ err: error }, "Dashboard claims query failed");
    res.status(500).json({
      success: false,
      error: "Claim activity is unavailable.",
    });
  }
});

export default router;