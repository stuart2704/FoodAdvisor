import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createCheckoutSession } from "../services/stripeService";

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

const CheckoutBody = z
  .object({
    portalToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

router.post(
  "/premium/checkout",
  checkoutLimiter,
  async (req, res): Promise<void> => {
    const body = CheckoutBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        success: false,
        error: "A valid portal login is required.",
      });
      return;
    }
    try {
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
      req.log.error({ err: error }, "Premium checkout creation failed");
      res.status(502).json({
        success: false,
        error: "Premium checkout is temporarily unavailable. No charge was made.",
      });
    }
  },
);

export default router;