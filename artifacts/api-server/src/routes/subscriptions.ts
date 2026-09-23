import { Router, type IRouter } from "express";
import {
  ClaimRestaurantBody,
  ClaimRestaurantParams,
  ClaimRestaurantResponse,
} from "@workspace/api-zod";
import {
  analyticsEventsTable,
  claimPageEventsTable,
  db,
  restaurantsTable,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  withInstantlyRestaurantLock,
} from "../outreach/instantlyService";
import { enqueueAllInstantlyCancellationIntents } from "../services/instantly/cancellationIntents";
import {
  ClaimLinkConfigurationError,
  verifyClaimLink,
} from "../lib/claim-link";
import { startOnboarding } from "../services/onboardingService";
import { escalateClaimClick } from "../services/leadEscalationService";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import {
  createCheckoutSession,
  getCheckoutCompletion,
} from "../services/stripeService";
import { validateToken } from "../services/portalTokenService";

const router: IRouter = Router();
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many checkout attempts. Please try again later.",
  },
});
const PortalCheckoutBody = z
  .object({ portalToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
const CheckoutCompletionParams = z.object({
  sessionId: z.string().regex(/^cs_(?:test_|live_)?[A-Za-z0-9]{20,200}$/),
});
const CheckoutCompletionQuery = z.object({
  portalToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

router.post("/restaurants/:placeId/claim-click", async (req, res): Promise<void> => {
  const params = ClaimRestaurantParams.safeParse(req.params);
  const body = z.object({ claimToken: z.string().min(40).max(2048) }).safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ success: false, error: "Invalid claim link." });
    return;
  }
  try {
    if (!verifyClaimLink(body.data.claimToken, params.data.placeId)) {
      res.status(403).json({ success: false, error: "Invalid claim link." });
      return;
    }
    const updated = await escalateClaimClick(params.data.placeId);
    if (!updated) {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    try {
      await db.insert(analyticsEventsTable).values({
        restaurantId: params.data.placeId,
        type: "claim_click",
        metadata: {},
      });
    } catch (error) {
      req.log.warn({ err: error }, "Claim click analytics could not be recorded");
    }
    res.json({ success: true });
  } catch {
    res.status(503).json({ success: false, error: "Claim activity is unavailable." });
  }
});

router.get("/checkout-completion/:sessionId", async (req, res): Promise<void> => {
  const params = CheckoutCompletionParams.safeParse(req.params);
  const query = CheckoutCompletionQuery.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ success: false, error: "Invalid checkout details." });
    return;
  }
  try {
    const completion = await getCheckoutCompletion(
      query.data.portalToken,
      params.data.sessionId,
    );
    res.json({ success: true, ...completion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message === "Invalid or expired portal login." ||
      message === "Checkout session does not belong to this restaurant."
    ) {
      res.status(403).json({ success: false, error: message });
      return;
    }
    if (message === "Restaurant not found.") {
      res.status(404).json({ success: false, error: message });
      return;
    }
    req.log.error({ err: error }, "Checkout completion lookup failed");
    res.status(502).json({
      success: false,
      error: "Checkout confirmation is temporarily unavailable.",
    });
  }
});

router.post("/restaurants/:placeId/claim", async (req, res): Promise<void> => {
  const params = ClaimRestaurantParams.safeParse(req.params);
  const body = ClaimRestaurantBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: "A valid place ID, business email, and claim link are required.",
    });
    return;
  }
  let validLink: boolean;
  try {
    validLink = verifyClaimLink(body.data.claimToken, params.data.placeId);
  } catch (error) {
    if (error instanceof ClaimLinkConfigurationError) {
      res.status(503).json({ error: "Claims are temporarily unavailable." });
      return;
    }
    throw error;
  }
  if (!validLink) {
    res.status(403).json({ error: "This claim link is invalid or has expired." });
    return;
  }
  try {
    const result = await withInstantlyRestaurantLock(params.data.placeId, async () => {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            placeId: restaurantsTable.placeId,
            claimStatus: restaurantsTable.claimStatus,
          })
          .from(restaurantsTable)
          .where(eq(restaurantsTable.placeId, params.data.placeId))
          .limit(1);
        if (!existing) return { kind: "not_found" } as const;
        if (existing.claimStatus !== null) {
          return { kind: "already_claimed", placeId: existing.placeId } as const;
        }
        // This conditional transition is the replay guard for stateless,
        // signed links. A successful first claim makes later replays no-ops.
        const [updated] = await tx
          .update(restaurantsTable)
          .set({
            claimEmail: body.data.email.trim().toLowerCase(),
            claimStatus: "basic",
          })
          .where(
            and(
              eq(restaurantsTable.placeId, params.data.placeId),
              isNull(restaurantsTable.claimStatus),
            ),
          )
          .returning({ placeId: restaurantsTable.placeId });
        if (updated) await enqueueAllInstantlyCancellationIntents(tx, updated.placeId);
        return updated
          ? ({ kind: "basic", placeId: updated.placeId } as const)
          : ({ kind: "invalid_link" } as const);
      });
    });
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Restaurant not found." });
      return;
    }
    if (result.kind === "invalid_link") {
      res.status(403).json({ error: "This claim link is invalid or has expired." });
      return;
    }
    const onboarding =
      result.kind === "basic" ? await startOnboarding(result.placeId) : null;
    if (result.kind === "basic") {
      try {
        await db.insert(claimPageEventsTable).values({
          placeId: result.placeId,
          eventType: "completed",
          alreadyClaimed: false,
        });
      } catch (error) {
        req.log.warn({ err: error }, "Claim completion metric could not be recorded");
      }
    }
    const claimResponse = ClaimRestaurantResponse.parse({
        placeId: result.placeId,
        status: result.kind,
      });
    res.json({
      ...claimResponse,
      ...(onboarding ? { portalToken: onboarding.portalToken } : {}),
    });
  } catch {
    res.status(503).json({ error: "Claims are temporarily unavailable." });
  }
});

router.post(
  "/restaurants/:placeId/checkout",
  checkoutLimiter,
  async (req, res): Promise<void> => {
    const params = ClaimRestaurantParams.safeParse(req.params);
    const body = PortalCheckoutBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        success: false,
        error: "A valid restaurant and portal login are required.",
      });
      return;
    }
    try {
      const tokenPlaceId = await validateToken(body.data.portalToken);
      if (tokenPlaceId !== params.data.placeId) {
        res.status(403).json({
          success: false,
          error: "This portal login does not match the restaurant.",
        });
        return;
      }
      const url = await createCheckoutSession(body.data.portalToken);
      res.status(201).json({ success: true, url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "Invalid or expired portal login.") {
        res.status(401).json({ success: false, error: message });
        return;
      }
      if (
        message === "This restaurant already has a subscription." ||
        message === "This restaurant already has a checkout awaiting confirmation." ||
        message === "A claimed business email is required."
      ) {
        res.status(409).json({ success: false, error: message });
        return;
      }
      if (
        message === "STRIPE_PREMIUM_PRICE_ID is not configured." ||
        message.includes("public HTTPS")
      ) {
        res.status(503).json({
          success: false,
          error: "Premium checkout is not configured yet. No charge was made.",
        });
        return;
      }
      req.log.error({ err: error }, "Restaurant checkout creation failed");
      res.status(502).json({
        success: false,
        error: "Premium checkout is temporarily unavailable. No charge was made.",
      });
    }
  },
);

export default router;
