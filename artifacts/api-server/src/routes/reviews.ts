import { getAuth } from "@clerk/express";
import { db, restaurantReviewsTable, restaurantsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const router: IRouter = Router();

const CreateReviewBody = z.object({
  restaurantId: z.string().trim().min(1).max(512),
  rating: z.coerce.number().int().min(1).max(5),
  review: z.string().trim().min(3).max(2_000),
});

const ReviewParams = z.object({
  id: z.string().trim().min(1).max(512),
});

const reviewLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/reviews", reviewLimiter, async (req, res) => {
  const auth = getAuth(req);
  const userId = auth.userId;
  if (!userId) {
    res.status(401).json({ success: false, error: "Sign in to add a review." });
    return;
  }
  const parsed = CreateReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Review details are invalid." });
    return;
  }
  try {
    const [restaurant] = await db
      .select({ id: restaurantsTable.placeId })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, parsed.data.restaurantId))
      .limit(1);
    if (!restaurant) {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    const [review] = await db
      .insert(restaurantReviewsTable)
      .values({
        restaurantId: parsed.data.restaurantId,
        clerkUserId: userId,
        rating: parsed.data.rating,
        review: parsed.data.review,
      })
      .returning({
        id: restaurantReviewsTable.id,
        rating: restaurantReviewsTable.rating,
        review: restaurantReviewsTable.review,
        createdAt: restaurantReviewsTable.createdAt,
      });
    res.status(201).json({ success: true, data: review });
  } catch (error) {
    req.log.error({ err: error }, "Review creation failed");
    res.status(503).json({ success: false, error: "Review could not be added." });
  }
});

router.get("/reviews/:id", async (req, res) => {
  const parsed = ReviewParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant ID." });
    return;
  }
  try {
    const reviews = await db
      .select({
        id: restaurantReviewsTable.id,
        rating: restaurantReviewsTable.rating,
        review: restaurantReviewsTable.review,
        createdAt: restaurantReviewsTable.createdAt,
      })
      .from(restaurantReviewsTable)
      .where(eq(restaurantReviewsTable.restaurantId, parsed.data.id))
      .orderBy(desc(restaurantReviewsTable.createdAt))
      .limit(100);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: reviews });
  } catch (error) {
    req.log.error({ err: error }, "Review query failed");
    res.status(503).json({ success: false, error: "Reviews are unavailable." });
  }
});

export default router;