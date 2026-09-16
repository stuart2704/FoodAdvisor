import { db, restaurantsTable } from "@workspace/db";
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";
import { qualifyRestaurant } from "../services/leadQualificationService";

const router: IRouter = Router();
const scoringLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

router.get("/lead-qualification", adminOnly, async (req, res) => {
  try {
    const [[totals], tiers, items] = await Promise.all([
      db
        .select({
          qualified:
            sql<number>`count(*) filter (where ${restaurantsTable.qualificationScore} is not null)`.mapWith(Number),
          unqualified:
            sql<number>`count(*) filter (where ${restaurantsTable.qualificationScore} is null)`.mapWith(Number),
          averageScore:
            sql<number>`coalesce(avg(${restaurantsTable.qualificationScore}), 0)`.mapWith(Number),
        })
        .from(restaurantsTable),
      db
        .select({
          tier: restaurantsTable.qualificationTier,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(restaurantsTable)
        .where(isNotNull(restaurantsTable.qualificationTier))
        .groupBy(restaurantsTable.qualificationTier),
      db
        .select({
          placeId: restaurantsTable.placeId,
          name: restaurantsTable.name,
          city: restaurantsTable.city,
          score: restaurantsTable.qualificationScore,
          tier: restaurantsTable.qualificationTier,
          reason: restaurantsTable.qualificationReason,
          qualifiedAt: restaurantsTable.qualifiedAt,
        })
        .from(restaurantsTable)
        .where(isNotNull(restaurantsTable.qualificationScore))
        .orderBy(
          desc(restaurantsTable.qualificationScore),
          desc(restaurantsTable.qualifiedAt),
        )
        .limit(50),
    ]);
    res.json({
      success: true,
      qualified: totals?.qualified ?? 0,
      unqualified: totals?.unqualified ?? 0,
      averageScore: totals?.averageScore ?? 0,
      byTier: Object.fromEntries(
        ["A", "B", "C", "D"].map((tier) => [
          tier,
          tiers.find((row) => row.tier === tier)?.count ?? 0,
        ]),
      ),
      items,
      mode: "review",
    });
  } catch (error) {
    req.log.error({ err: error }, "Lead qualification dashboard query failed");
    res.status(500).json({
      success: false,
      error: "Lead qualification data is unavailable.",
    });
  }
});

router.post(
  "/lead-qualification/:placeId",
  adminOnly,
  scoringLimiter,
  async (req, res) => {
    const params = z
      .object({ placeId: z.string().trim().min(1).max(512) })
      .safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ success: false, error: "Invalid restaurant ID." });
      return;
    }
    try {
      const [restaurant] = await db
        .select()
        .from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, params.data.placeId))
        .limit(1);
      if (!restaurant) {
        res.status(404).json({ success: false, error: "Restaurant not found." });
        return;
      }
      const result = await qualifyRestaurant(restaurant);
      res.json({ success: true, ...result, mode: "review" });
    } catch (error) {
      req.log.error({ err: error }, "Lead qualification failed");
      res.status(503).json({
        success: false,
        error: "Restaurant qualification could not be completed.",
      });
    }
  },
);

export default router;