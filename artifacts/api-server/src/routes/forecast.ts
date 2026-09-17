import {
  db,
  restaurantBookingsTable,
  restaurantReviewsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { validateToken } from "../services/portalTokenService";

const router: IRouter = Router();

const PortalParams = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

router.get("/portal/:token/forecast", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const parsed = PortalParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const placeId = await validateToken(parsed.data.token);
  if (!placeId) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  try {
    const [[bookingCount], [reviewCount]] = await Promise.all([
      db
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(restaurantBookingsTable)
        .where(eq(restaurantBookingsTable.restaurantId, placeId)),
      db
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(restaurantReviewsTable)
        .where(eq(restaurantReviewsTable.restaurantId, placeId)),
    ]);
    const bookings = bookingCount?.count ?? 0;
    const reviews = reviewCount?.count ?? 0;
    const currentEngagementScore = bookings * 5 + reviews * 2;
    res.json({
      success: true,
      data: {
        bookings,
        reviews,
        currentEngagementScore,
        annualEngagementProjection: currentEngagementScore * 12,
        methodology:
          "Illustrative activity projection: (booking requests × 5 + reviews × 2) × 12. This is not a revenue forecast.",
      },
    });
  } catch (error) {
    req.log.error({ err: error, placeId }, "Owner engagement forecast failed");
    res.status(503).json({
      success: false,
      error: "The engagement projection is temporarily unavailable.",
    });
  }
});

export default router;