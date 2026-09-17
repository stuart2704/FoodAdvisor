import { getAuth } from "@clerk/express";
import {
  db,
  restaurantFavouritesTable,
  restaurantsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const router: IRouter = Router();

const FavouriteBody = z.object({
  restaurantId: z.string().trim().min(1).max(512),
});

const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/favourites", async (req, res) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ success: false, error: "Sign in to view favourites." });
    return;
  }
  try {
    const results = await db
      .select({
        id: restaurantsTable.placeId,
        name: restaurantsTable.name,
        slug: restaurantsTable.slug,
        city: restaurantsTable.city,
        cuisine: restaurantsTable.cuisineTags,
        rating: restaurantsTable.rating,
        premium: restaurantsTable.premium,
      })
      .from(restaurantFavouritesTable)
      .innerJoin(
        restaurantsTable,
        eq(restaurantFavouritesTable.restaurantId, restaurantsTable.placeId),
      )
      .where(eq(restaurantFavouritesTable.clerkUserId, userId))
      .orderBy(desc(restaurantFavouritesTable.createdAt));
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, results });
  } catch (error) {
    req.log.error({ err: error }, "Favourite query failed");
    res.status(503).json({ success: false, error: "Favourites are unavailable." });
  }
});

router.post("/favourites", writeLimiter, async (req, res) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ success: false, error: "Sign in to save favourites." });
    return;
  }
  const parsed = FavouriteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant ID." });
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
    await db
      .insert(restaurantFavouritesTable)
      .values({
        clerkUserId: userId,
        restaurantId: parsed.data.restaurantId,
      })
      .onConflictDoNothing();
    res.status(201).json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Favourite creation failed");
    res.status(503).json({ success: false, error: "Favourite could not be saved." });
  }
});

router.delete("/favourites/:restaurantId", writeLimiter, async (req, res) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ success: false, error: "Sign in to update favourites." });
    return;
  }
  const parsed = FavouriteBody.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant ID." });
    return;
  }
  try {
    await db
      .delete(restaurantFavouritesTable)
      .where(
        and(
          eq(restaurantFavouritesTable.clerkUserId, userId),
          eq(restaurantFavouritesTable.restaurantId, parsed.data.restaurantId),
        ),
      );
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Favourite removal failed");
    res.status(503).json({ success: false, error: "Favourite could not be removed." });
  }
});

export default router;