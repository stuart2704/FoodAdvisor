import { db, restaurantsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { calculateRanking } from "../services/rankingEngine";

const router: IRouter = Router();

router.get("/rank", async (req, res) => {
  try {
    const restaurants = await db
      .select({
        id: restaurantsTable.placeId,
        slug: restaurantsTable.slug,
        name: restaurantsTable.name,
        city: restaurantsTable.city,
        rating: restaurantsTable.rating,
        cuisineTags: restaurantsTable.cuisineTags,
        premium: restaurantsTable.premium,
        qualificationScore: restaurantsTable.qualificationScore,
        popularity: restaurantsTable.popularity,
        aiRelevanceBoost: restaurantsTable.aiRelevanceBoost,
      })
      .from(restaurantsTable)
      .orderBy(
        desc(restaurantsTable.premium),
        desc(restaurantsTable.rankingScore),
        desc(restaurantsTable.rating),
      )
      .limit(200);
    const ranked = restaurants
      .map((restaurant) => ({
        id: restaurant.id,
        slug: restaurant.slug,
        name: restaurant.name,
        city: restaurant.city,
        rating: restaurant.rating,
        cuisine: restaurant.cuisineTags[0] ?? null,
        premium: restaurant.premium,
        score: calculateRanking({
          premium: restaurant.premium,
          score: restaurant.qualificationScore,
          popularity: restaurant.popularity,
          aiRelevanceBoost: restaurant.aiRelevanceBoost,
          city: restaurant.city,
          country: "United Kingdom",
          cuisine: restaurant.cuisineTags[0] ?? null,
        }),
      }))
      .sort(
        (left, right) =>
          Number(right.premium) - Number(left.premium) ||
          right.score - left.score ||
          (right.rating ?? 0) - (left.rating ?? 0),
      )
      .slice(0, 50);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: ranked });
  } catch (error) {
    req.log.error({ err: error }, "Public ranking query failed");
    res.status(503).json({
      success: false,
      error: "Restaurant rankings are temporarily unavailable.",
    });
  }
});

export default router;