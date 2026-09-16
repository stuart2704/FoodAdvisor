import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  getRecommendedForVisitor,
  getSimilarRestaurants,
  getTopCuisine,
  getTrending,
} from "../services/recommendationEngine";
import { getVisitorProfile } from "../services/personalisationEngine";

const router: IRouter = Router();
const VisitorId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

function toPublicRestaurant(restaurant: {
  placeId: string;
  name: string;
  city: string;
  cuisineTags: string[];
  dietaryTags: string[];
  rating: number | null;
  premium: boolean;
}) {
  return {
    id: restaurant.placeId,
    name: restaurant.name,
    city: restaurant.city,
    country: "United Kingdom",
    cuisine: restaurant.cuisineTags[0] ?? null,
    tags: [...new Set([...restaurant.cuisineTags, ...restaurant.dietaryTags])],
    rating: restaurant.rating,
    premium: restaurant.premium,
  };
}

router.get("/recommendations", async (req, res) => {
  const visitorId = req.get("X-Visitor-Id");
  if (!visitorId) {
    res.status(400).json({
      success: false,
      error: "A visitor profile is required for recommendations.",
    });
    return;
  }
  if (!VisitorId.safeParse(visitorId).success) {
    res.status(400).json({
      success: false,
      error: "The visitor profile identifier is invalid.",
    });
    return;
  }
  try {
    const profile = await getVisitorProfile(visitorId);
    if (!profile) {
      res.status(404).json({
        success: false,
        error: "Visitor profile not found.",
      });
      return;
    }
    const recommended = await getRecommendedForVisitor(profile);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "X-Visitor-Id");
    res.json({
      success: true,
      data: recommended.map(toPublicRestaurant),
    });
  } catch (error) {
    req.log.error({ err: error }, "Visitor recommendations failed");
    res.status(503).json({
      success: false,
      error: "Visitor recommendations are temporarily unavailable.",
    });
  }
});

router.get("/recommendations/trending", async (req, res) => {
  const visitorId = req.get("X-Visitor-Id");
  if (!visitorId || !VisitorId.safeParse(visitorId).success) {
    res.status(400).json({
      success: false,
      error: "A valid visitor profile is required for local trends.",
    });
    return;
  }
  try {
    const profile = await getVisitorProfile(visitorId);
    const city = profile?.preferredCities.at(-1);
    if (!profile || !city) {
      res.status(404).json({
        success: false,
        error: "No preferred city is available for this visitor profile.",
      });
      return;
    }
    const trending = await getTrending(city);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "X-Visitor-Id");
    res.json({
      success: true,
      city,
      data: trending.map(toPublicRestaurant),
    });
  } catch (error) {
    req.log.error({ err: error }, "Local trending recommendations failed");
    res.status(503).json({
      success: false,
      error: "Local trending restaurants are temporarily unavailable.",
    });
  }
});

router.get("/recommendations/top-cuisine", async (req, res) => {
  const visitorId = req.get("X-Visitor-Id");
  if (!visitorId || !VisitorId.safeParse(visitorId).success) {
    res.status(400).json({
      success: false,
      error: "A valid visitor profile is required for cuisine picks.",
    });
    return;
  }
  try {
    const profile = await getVisitorProfile(visitorId);
    const cuisine = profile?.preferredCuisines.at(-1);
    if (!profile || !cuisine) {
      res.status(404).json({
        success: false,
        error: "No preferred cuisine is available for this visitor profile.",
      });
      return;
    }
    const topCuisine = await getTopCuisine(cuisine);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "X-Visitor-Id");
    res.json({
      success: true,
      cuisine,
      data: topCuisine.map(toPublicRestaurant),
    });
  } catch (error) {
    req.log.error({ err: error }, "Top cuisine recommendations failed");
    res.status(503).json({
      success: false,
      error: "Top cuisine picks are temporarily unavailable.",
    });
  }
});

router.get("/restaurants/:id/similar", async (req, res) => {
  const params = z
    .object({ id: z.string().trim().min(1).max(512) })
    .safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ success: false, error: "Restaurant ID is invalid." });
    return;
  }
  try {
    const similar = await getSimilarRestaurants(params.data.id);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ success: true, data: similar.map(toPublicRestaurant) });
  } catch (error) {
    if (error instanceof Error && error.message === "Restaurant not found.") {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    req.log.error({ err: error }, "Similar restaurant query failed");
    res.status(503).json({
      success: false,
      error: "Similar restaurants are temporarily unavailable.",
    });
  }
});

export default router;