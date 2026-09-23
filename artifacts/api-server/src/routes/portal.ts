import { db, restaurantOffersTable, restaurantsTable } from "@workspace/db";
import { and, asc, eq, gte } from "drizzle-orm";
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
const offerIdParamsSchema = tokenParamsSchema.extend({
  offerId: z.coerce.number().int().positive(),
});
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must use YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Date is not a valid calendar date.");
const offerBodySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  })
  .strict()
  .superRefine((offer, context) => {
    const today = new Date().toISOString().slice(0, 10);
    if (offer.startDate > offer.endDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after the start date.",
      });
    }
    if (offer.endDate < today) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Expired offers cannot be published.",
      });
    }
  });

function setPortalPrivacyHeaders(res: {
  setHeader(name: string, value: string): unknown;
}) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
}

async function getVerifiedOwnerPlaceId(token: string): Promise<string | null> {
  const placeId = await validateToken(token);
  if (!placeId) return null;
  const [restaurant] = await db
    .select({ claimedAt: restaurantsTable.claimedAt })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  return restaurant?.claimedAt ? placeId : null;
}

function invalidPortalLink(res: {
  status(code: number): { json(value: unknown): unknown };
}) {
  res.status(404).json({ success: false, error: "Invalid or expired login link." });
}

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

router.get("/portal/:token/offers", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const offers = await db
    .select({
      id: restaurantOffersTable.id,
      title: restaurantOffersTable.title,
      description: restaurantOffersTable.description,
      startDate: restaurantOffersTable.startDate,
      endDate: restaurantOffersTable.endDate,
    })
    .from(restaurantOffersTable)
    .where(
      and(
        eq(restaurantOffersTable.restaurantId, placeId),
        gte(restaurantOffersTable.endDate, today),
      ),
    )
    .orderBy(asc(restaurantOffersTable.startDate), asc(restaurantOffersTable.id));
  res.json({ success: true, offers });
});

router.post("/portal/:token/offers", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  const body = offerBodySchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({
      success: false,
      error: body.error.issues[0]?.message ?? "Invalid offer.",
    });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [offer] = await db
    .insert(restaurantOffersTable)
    .values({ restaurantId: placeId, ...body.data })
    .returning();
  res.status(201).json({ success: true, offer });
});

router.patch("/portal/:token/offers/:offerId", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = offerIdParamsSchema.safeParse(req.params);
  const body = offerBodySchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({
      success: false,
      error: body.error.issues[0]?.message ?? "Invalid offer.",
    });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [offer] = await db
    .update(restaurantOffersTable)
    .set(body.data)
    .where(
      and(
        eq(restaurantOffersTable.id, params.data.offerId),
        eq(restaurantOffersTable.restaurantId, placeId),
      ),
    )
    .returning();
  if (!offer) {
    res.status(404).json({ success: false, error: "Offer not found." });
    return;
  }
  res.json({ success: true, offer });
});

router.delete("/portal/:token/offers/:offerId", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = offerIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [offer] = await db
    .delete(restaurantOffersTable)
    .where(
      and(
        eq(restaurantOffersTable.id, params.data.offerId),
        eq(restaurantOffersTable.restaurantId, placeId),
      ),
    )
    .returning({ id: restaurantOffersTable.id });
  if (!offer) {
    res.status(404).json({ success: false, error: "Offer not found." });
    return;
  }
  res.json({ success: true });
});

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