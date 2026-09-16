import { db, restaurantsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { getErrorSummary } from "../dashboard/errorSummary";
import { getStatusCounts } from "../dashboard/statusStats";
import { getRecentHealth, computeDailyHealthScore } from "../health/scraperHealth";
import { adminOnly } from "../middleware/adminOnly";
import { getEvents } from "../utils/eventLog";

const router: IRouter = Router();

router.get("/events", adminOnly, (_req, res) => {
  res.json(getEvents());
});

router.get("/health", adminOnly, (_req, res) => {
  res.json({
    recent: getRecentHealth(),
    score: computeDailyHealthScore(),
    scope: "current_process",
    scoringWindow: "last_10_samples_today_utc",
  });
});

router.get("/status", adminOnly, async (_req, res) => {
  try {
    res.json(await getStatusCounts());
  } catch {
    res.status(503).json({ error: "Dashboard status counts are unavailable." });
  }
});

router.get("/errors", adminOnly, (_req, res) => {
  res.json(getErrorSummary());
});

router.get("/stats", adminOnly, async (_req, res) => {
  try {
    const [statusCounts, [totals]] = await Promise.all([
      getStatusCounts(),
      db
        .select({
          totalRestaurants: sql<number>`count(*)`.mapWith(Number),
          outreachSent:
            sql<number>`coalesce(sum(${restaurantsTable.outreachCount}), 0)`.mapWith(Number),
          claims:
            sql<number>`count(*) filter (where ${restaurantsTable.claimStatus} is not null)`.mapWith(Number),
        })
        .from(restaurantsTable),
    ]);
    res.json({
      success: true,
      totalRestaurants: totals?.totalRestaurants ?? 0,
      outreachSent: totals?.outreachSent ?? 0,
      claims: totals?.claims ?? 0,
      statusCounts,
      healthScore: computeDailyHealthScore(),
      recentEvents: getEvents().slice(-10),
      healthScope: "current_process",
    });
  } catch {
    res.status(503).json({
      success: false,
      error: "Dashboard stats are unavailable.",
    });
  }
});

router.get("/restaurants", adminOnly, async (req, res) => {
  const pagination = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .safeParse(req.query);
  if (!pagination.success) {
    res.status(400).json({ success: false, error: "Invalid pagination." });
    return;
  }

  const { page, limit } = pagination.data;
  const offset = (page - 1) * limit;
  try {
    const [[countRow], restaurants] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(restaurantsTable),
      db
        .select({
          placeId: restaurantsTable.placeId,
          name: restaurantsTable.name,
          address: restaurantsTable.address,
          city: restaurantsTable.city,
          country: sql<string>`'United Kingdom'`,
          rating: restaurantsTable.rating,
          website: restaurantsTable.website,
          publicBusinessEmail: restaurantsTable.publicBusinessEmail,
          outreachStatus: restaurantsTable.outreachStatus,
          outreachCount: restaurantsTable.outreachCount,
          claimStatus: restaurantsTable.claimStatus,
          importedAt: restaurantsTable.importedAt,
        })
        .from(restaurantsTable)
        .orderBy(desc(restaurantsTable.importedAt), restaurantsTable.placeId)
        .limit(limit)
        .offset(offset),
    ]);
    res.json({
      success: true,
      page,
      limit,
      total: countRow?.count ?? 0,
      restaurants,
    });
  } catch {
    res.status(503).json({
      success: false,
      error: "Dashboard restaurants are unavailable.",
    });
  }
});

router.get("/summary", adminOnly, async (_req, res) => {
  try {
    const statusCounts = await getStatusCounts();
    res.json({
      statusCounts,
      healthScore: computeDailyHealthScore(),
      recentEvents: getEvents().slice(-10),
      healthScope: "current_process",
    });
  } catch {
    res.status(503).json({ error: "Dashboard summary is unavailable." });
  }
});

export default router;