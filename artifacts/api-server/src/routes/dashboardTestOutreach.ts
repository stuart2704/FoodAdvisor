import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";
import { sendEmail1 } from "../outreach/sendingService";

const router: IRouter = Router();

const testOutreachLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const requestSchema = z
  .object({
    restaurantId: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine(
        (value) => !/[\r\n\u0000-\u001f\u007f]/.test(value),
        "Invalid restaurant ID.",
      ),
    confirm: z.literal(true),
  })
  .strict();

router.post(
  "/test-outreach",
  adminOnly,
  testOutreachLimiter,
  async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error:
          "A restaurantId and confirm: true are required because this action may send a real email.",
      });
      return;
    }

    try {
      const result = await sendEmail1({ placeId: parsed.data.restaurantId });
      if (result.status === "not_sent") {
        res.status(409).json({
          success: false,
          error: result.reason,
          result,
        });
        return;
      }
      res.status(result.status === "queued" ? 202 : 200).json({
        success: true,
        result,
      });
    } catch (error) {
      req.log.error({ err: error }, "Admin test outreach failed");
      res.status(503).json({
        success: false,
        error:
          "Test outreach could not run. Check outreach configuration and restaurant eligibility.",
      });
    }
  },
);

export default router;