import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  AnalyticsEventType,
  logEvent,
} from "../services/analyticsEngine";

const router: IRouter = Router();

const analyticsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const EventBody = z.object({
  restaurantId: z.string().trim().min(1).max(512),
  type: AnalyticsEventType,
  metadata: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
}).refine(
  (value) =>
    !value.metadata ||
    (!Object.hasOwn(value.metadata, "viewedWith") &&
      value.metadata.source !== "server_profile"),
  { message: "Reserved analytics metadata is not accepted." },
);

router.post("/analytics/events", analyticsLimiter, async (req, res) => {
  const parsed = EventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid analytics event." });
    return;
  }
  try {
    await logEvent(
      parsed.data.restaurantId,
      parsed.data.type,
      parsed.data.metadata,
    );
    res.status(204).end();
  } catch (error) {
    req.log.warn({ err: error }, "Analytics event was rejected");
    res.status(400).json({ success: false, error: "Invalid analytics event." });
  }
});

export default router;