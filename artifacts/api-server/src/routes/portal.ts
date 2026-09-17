import { db, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { validateToken } from "../services/portalTokenService";
import { logEvent } from "../services/analyticsEngine";
import { getRestaurantAnalytics } from "../services/analyticsEngine";
import { generateOwnerAnalyticsInsight } from "../services/ownerAnalyticsInsight";
import { recordOwnerLogin } from "../services/personalisationEngine";

const router: IRouter = Router();

router.get("/portal/:token", async (req, res) => {
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
    .select({
      placeId: restaurantsTable.placeId,
      name: restaurantsTable.name,
      description: restaurantsTable.websiteDescription,
      address: restaurantsTable.address,
      website: restaurantsTable.website,
      onboardingStatus: restaurantsTable.onboardingStatus,
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
    restaurant: { ...restaurant, verified: restaurant.verified !== null },
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