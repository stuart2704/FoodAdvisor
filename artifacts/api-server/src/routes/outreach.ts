import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  EnrichRestaurantParams,
  EnrichRestaurantResponse,
  RunOutreachAutomationResponse,
  UnsubscribeRestaurantOutreachParams,
  UnsubscribeRestaurantOutreachResponse,
} from "@workspace/api-zod";
import { runDailyOutreach, suppressByToken } from "../lib/outreach";
import { enrichRestaurant } from "../services/enrichment/enrichRestaurant";

const router: IRouter = Router();

function validAutomationToken(header: string | undefined): boolean {
  const expected = process.env.AUTOMATION_TOKEN;
  const supplied = header?.match(/^Bearer (.+)$/i)?.[1];
  if (!expected || expected.length < 32 || !supplied) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

router.post("/automation/outreach", async (req, res): Promise<void> => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  try {
    const result = await runDailyOutreach();
    res.json(RunOutreachAutomationResponse.parse(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outreach failed.";
    req.log.warn({ err: error }, "Outreach automation did not run");
    res.status(503).json({ error: message });
  }
});

router.post(
  "/restaurants/:placeId/enrich",
  async (req, res): Promise<void> => {
    if (!validAutomationToken(req.header("authorization"))) {
      res.status(401).json({ error: "Invalid automation credential." });
      return;
    }
    const parsed = EnrichRestaurantParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(404).json({ error: "Restaurant not found." });
      return;
    }
    const result = await enrichRestaurant(parsed.data.placeId);
    if (!result.ok) {
      const status = result.error.code === "restaurant_not_found" ? 404 : 422;
      res.status(status).json({ error: result.error.message });
      return;
    }
    res.json(
      EnrichRestaurantResponse.parse({
        message: "Enrichment complete.",
        placeId: result.placeId,
        email: result.email,
        finalUrl: result.finalUrl,
        cuisines: result.cuisine.cuisines,
        dietaryTags: result.cuisine.dietaryTags,
        confidence: result.cuisine.confidence,
      }),
    );
  },
);

router.post(
  "/outreach/unsubscribe/:token",
  async (req, res): Promise<void> => {
    const parsed = UnsubscribeRestaurantOutreachParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(404).json({ error: "Invalid unsubscribe token." });
      return;
    }
    const suppressed = await suppressByToken(parsed.data.token);
    if (!suppressed) {
      res.status(404).json({ error: "Invalid unsubscribe token." });
      return;
    }
    res.json(UnsubscribeRestaurantOutreachResponse.parse({ suppressed: true }));
  },
);

export default router;