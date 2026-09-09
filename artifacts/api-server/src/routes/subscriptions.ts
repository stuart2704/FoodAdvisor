import { Router, type IRouter } from "express";
import {
  ClaimRestaurantBody,
  ClaimRestaurantParams,
  ClaimRestaurantResponse,
  CreateRestaurantCheckoutBody,
  CreateRestaurantCheckoutParams,
  CreateRestaurantCheckoutResponse,
} from "@workspace/api-zod";
import { db, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createMonthlyCheckout } from "../lib/stripe-checkout";

const router: IRouter = Router();

router.post("/restaurants/:placeId/claim", async (req, res): Promise<void> => {
  const params = ClaimRestaurantParams.safeParse(req.params);
  const body = ClaimRestaurantBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "A valid place ID and email are required." });
    return;
  }
  const [restaurant] = await db
    .update(restaurantsTable)
    .set({
      claimEmail: body.data.email.trim().toLowerCase(),
      claimStatus: "pending_checkout",
    })
    .where(eq(restaurantsTable.placeId, params.data.placeId))
    .returning({ placeId: restaurantsTable.placeId });
  if (!restaurant) {
    res.status(404).json({ error: "Restaurant not found." });
    return;
  }
  res.json(
    ClaimRestaurantResponse.parse({
      placeId: restaurant.placeId,
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
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, params.data.placeId))
      .limit(1);
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant not found." });
      return;
    }
    try {
      const checkoutUrl = await createMonthlyCheckout({
        placeId: restaurant.placeId,
        restaurantName: restaurant.name,
        email: body.data.email.trim().toLowerCase(),
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
      const message = error instanceof Error ? error.message : "Checkout failed.";
      req.log.warn({ err: error }, "Stripe Checkout was not created");
      const status = message.includes("must") ? 503 : 400;
      res.status(status).json({ error: message });
    }
  },
);

export default router;