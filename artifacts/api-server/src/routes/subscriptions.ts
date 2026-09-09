import { Router, type IRouter } from "express";
import {
  ClaimRestaurantBody,
  ClaimRestaurantParams,
  ClaimRestaurantResponse,
  CreateRestaurantCheckoutBody,
  CreateRestaurantCheckoutParams,
  CreateRestaurantCheckoutResponse,
  GetCheckoutCompletionResponse,
} from "@workspace/api-zod";
import { db, restaurantsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { createMonthlyCheckout } from "../lib/stripe-checkout";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

router.get("/checkout-completion/:sessionId", async (req, res): Promise<void> => {
  const sessionId = req.params.sessionId;
  if (!sessionId || sessionId.length > 255) {
    res.status(400).json({ error: "A valid Checkout session ID is required." });
    return;
  }
  const result = await db.execute(sql`
    SELECT r.place_id AS "placeId", r.name,
      r.claim_status AS "claimStatus",
      cs.payment_status AS "paymentStatus"
    FROM stripe.checkout_sessions cs
    JOIN public.restaurants r
      ON r.place_id = COALESCE(cs.metadata->>'place_id', '')
    WHERE cs.id = ${sessionId}
    LIMIT 1
  `);
  const row = result.rows[0] as {
    placeId: string;
    name: string;
    claimStatus: string | null;
    paymentStatus: string | null;
  } | undefined;
  if (!row) {
    res.json({
      placeId: null,
      name: null,
      claimStatus: "processing",
      paymentStatus: "processing",
    });
    return;
  }
  res.json(GetCheckoutCompletionResponse.parse({
    placeId: row.placeId,
    name: row.name,
    claimStatus: row.claimStatus ?? "processing",
    paymentStatus: row.paymentStatus ?? "processing",
  }));
});

router.post("/restaurants/:placeId/claim", async (req, res): Promise<void> => {
  const params = ClaimRestaurantParams.safeParse(req.params);
  const body = ClaimRestaurantBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "A valid place ID and email are required." });
    return;
  }
  const attemptId = randomUUID();
  const [restaurant] = await db
    .update(restaurantsTable)
    .set({
      claimEmail: body.data.email.trim().toLowerCase(),
      claimStatus: "pending_checkout",
      claimAttemptId: attemptId,
    })
    .where(sql`${restaurantsTable.placeId} = ${params.data.placeId} AND COALESCE(${restaurantsTable.claimStatus}, '') <> 'active'`)
    .returning({ placeId: restaurantsTable.placeId });
  if (!restaurant) {
    res.status(404).json({ error: "Restaurant not found." });
    return;
  }
  res.json(
    ClaimRestaurantResponse.parse({
      placeId: restaurant.placeId,
      attemptId,
      status: "pending_checkout",
      monthlyPricePence: 9900,
      currency: "gbp",
    }),
  );
});

router.post(
  "/restaurants/:placeId/checkout",
  async (req, res): Promise<void> => {
    const params = CreateRestaurantCheckoutParams.safeParse(req.params);
    const body = CreateRestaurantCheckoutBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "A valid place ID and email are required." });
      return;
    }
    const [restaurant] = await db
      .select({
        placeId: restaurantsTable.placeId,
        name: restaurantsTable.name,
        claimStatus: restaurantsTable.claimStatus,
        claimAttemptId: restaurantsTable.claimAttemptId,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, params.data.placeId))
      .limit(1);
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant not found." });
      return;
    }
    if (restaurant.claimStatus === "active" || !restaurant.claimAttemptId ||
        restaurant.claimAttemptId !== body.data.attemptId) {
      res.status(400).json({ error: "Start a new claim before checkout." });
      return;
    }
    try {
      const checkoutUrl = await createMonthlyCheckout({
        placeId: restaurant.placeId,
        restaurantName: restaurant.name,
        email: body.data.email.trim().toLowerCase(),
        attemptId: restaurant.claimAttemptId,
      });
      await db
        .update(restaurantsTable)
        .set({
          claimEmail: body.data.email.trim().toLowerCase(),
          claimStatus: "checkout_created",
        })
        .where(eq(restaurantsTable.placeId, restaurant.placeId));
      res.json(CreateRestaurantCheckoutResponse.parse({ checkoutUrl }));
    } catch (error) {
      req.log.warn({ err: error }, "Stripe Checkout was not created");
      res.status(503).json({ error: "Checkout is temporarily unavailable." });
    }
  },
);

export default router;