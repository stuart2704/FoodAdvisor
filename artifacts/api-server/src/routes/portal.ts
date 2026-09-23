import { db, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { validateToken } from "../services/portalTokenService";
import { logEvent } from "../services/analyticsEngine";
import { getRestaurantAnalytics } from "../services/analyticsEngine";
import { generateOwnerAnalyticsInsight } from "../services/ownerAnalyticsInsight";
import { recordOwnerLogin } from "../services/personalisationEngine";
import {
  generateSeoCopy,
  generateSocialCopy,
  seoLimiter,
  socialLimiter,
} from "./ai";

const router: IRouter = Router();
const tokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const socialMarketingSchema = z
  .object({
    tone: z
      .enum([
        "friendly",
        "professional",
        "premium",
        "casual",
        "playful",
        "energetic",
        "luxury",
        "fun",
        "romantic",
      ])
      .default("friendly"),
  })
  .strict();

async function getVerifiedMarketingDetails(token: string) {
  const placeId = await validateToken(token);
  if (!placeId) return null;
  const [restaurant] = await db
    .select({
      name: restaurantsTable.name,
      city: restaurantsTable.city,
      cuisineTags: restaurantsTable.cuisineTags,
      types: restaurantsTable.types,
      rating: restaurantsTable.rating,
      claimStatus: restaurantsTable.claimStatus,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant?.claimStatus) return null;
  return {
    name: restaurant.name,
    city: restaurant.city,
    cuisine:
      restaurant.cuisineTags.find((value) => value.trim()) ??
      restaurant.types.find((value) => value.trim()) ??
      "Restaurant",
    rating: restaurant.rating,
  };
}

router.post(
  "/portal/:token/marketing/seo",
  seoLimiter,
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Referrer-Policy", "no-referrer");
    const params = tokenParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ success: false, error: "Invalid or expired login link." });
      return;
    }
    const details = await getVerifiedMarketingDetails(params.data.token);
    if (!details) {
      res.status(404).json({ success: false, error: "Invalid or expired login link." });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ success: false, error: "AI SEO generation is not configured." });
      return;
    }
    try {
      const seo = await generateSeoCopy(details, (error) => {
        req.log.warn({ err: error }, "AI SEO usage could not be stored");
      });
      res.json({ success: true, seo });
    } catch (error) {
      req.log.warn({ err: error }, "Owner SEO generation failed");
      res.status(502).json({
        success: false,
        error: "AI SEO generation is temporarily unavailable.",
      });
    }
  },
);

router.post(
  "/portal/:token/marketing/social",
  socialLimiter,
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Referrer-Policy", "no-referrer");
    const params = tokenParamsSchema.safeParse(req.params);
    const body = socialMarketingSchema.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ success: false, error: "Invalid or expired login link." });
      return;
    }
    if (!body.success) {
      res.status(400).json({ success: false, error: "Invalid social post tone." });
      return;
    }
    const details = await getVerifiedMarketingDetails(params.data.token);
    if (!details) {
      res.status(404).json({ success: false, error: "Invalid or expired login link." });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({
        success: false,
        error: "AI social post generation is not configured.",
      });
      return;
    }
    try {
      const posts = await generateSocialCopy(
        { ...details, tone: body.data.tone },
        (error) => {
          req.log.warn({ err: error }, "AI social usage could not be stored");
        },
      );
      res.json({ success: true, posts });
    } catch (error) {
      req.log.warn({ err: error }, "Owner social generation failed");
      res.status(502).json({
        success: false,
        error: "AI social generation is temporarily unavailable.",
      });
    }
  },
);

router.get("/portal/:token", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  const params = tokenParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const placeId = await validateToken(params.data.token);
  if (!placeId) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const [restaurant] = await db
    .select({
      placeId: restaurantsTable.placeId,
      name: restaurantsTable.name,
      description: restaurantsTable.websiteDescription,
      address: restaurantsTable.address,
      website: restaurantsTable.website,
      onboardingStatus: restaurantsTable.onboardingStatus,
      claimStatus: restaurantsTable.claimStatus,
      verified: restaurantsTable.claimedAt,
      premium: restaurantsTable.premium,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  try {
    await Promise.all([
      logEvent(restaurant.placeId, "portal_login"),
      recordOwnerLogin(restaurant.placeId),
    ]);
  } catch (error) {
    req.log.warn({ err: error }, "Portal login state could not be recorded");
  }
  res.json({
    success: true,
    restaurant: {
      ...restaurant,
      verified: restaurant.verified !== null,
      marketingEligible: restaurant.claimStatus !== null,
    },
  });
});

router.post("/portal/:token/analytics-insight", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  const params = z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const placeId = await validateToken(params.data.token);
  if (!placeId) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const [restaurant] = await db
    .select({ premium: restaurantsTable.premium })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  try {
    const analytics = await getRestaurantAnalytics(placeId);
    const insight = await generateOwnerAnalyticsInsight(
      placeId,
      analytics,
      restaurant.premium,
    );
    res.json({ success: true, analytics, insight });
  } catch (error) {
    req.log.error({ err: error }, "Owner analytics insight failed");
    res.status(503).json({
      success: false,
      error: "Your analytics insight is temporarily unavailable.",
    });
  }
});

router.get("/portal/:token/analytics", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  const params = z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const placeId = await validateToken(params.data.token);
  if (!placeId) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  try {
    const analytics = await getRestaurantAnalytics(placeId);
    res.json({ success: true, analytics });
  } catch (error) {
    req.log.error({ err: error }, "Owner analytics failed");
    res.status(503).json({
      success: false,
      error: "Restaurant analytics are temporarily unavailable.",
    });
  }
});

export default router;