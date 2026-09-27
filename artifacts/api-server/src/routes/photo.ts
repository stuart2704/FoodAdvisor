import { Router, type IRouter } from "express";
import { z } from "zod";
import { PlacesBudgetExceededError } from "../lib/budgetedPlacesFetch";
import { getPlacePhotos } from "../lib/placePhotoLookup";
import { db, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { checkGooglePhotoAccess } from "../lib/photo-provider";

const router: IRouter = Router();
const PlaceParams = z.object({ placeId: z.string().trim().min(1).max(300) });

async function servePhotos(req: import("express").Request, res: import("express").Response, gallery: boolean) {
  const parsed = PlaceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid place ID." });
    return;
  }
  const { placeId } = parsed.data;
  try {
    // Authorize on every request, even when provider data is cached.
    const [restaurant] = await db.select({
      sourceName: restaurantsTable.sourceName,
      sourceAttribution: restaurantsTable.sourceAttribution,
      published: restaurantsTable.published,
    }).from(restaurantsTable).where(eq(restaurantsTable.placeId, placeId)).limit(1);
    const access = checkGooglePhotoAccess(placeId, restaurant ?? null);
    if (!access.allowed) {
      res.status(access.status).json(access.body);
      return;
    }
  } catch {
    res.status(503).json({ error: "Restaurant photo provider could not be determined." });
    return;
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Google Places photos are not configured." });
    return;
  }
  try {
    const photos = await getPlacePhotos(placeId, apiKey, gallery ? 6 : 1);
    // Server cache is bounded by the provider TTL. Browser caches cannot know how
    // much TTL remains on a cached URI, and must not bypass the publication check.
    res.setHeader("Cache-Control", "no-store");
    res.json(gallery ? { photos } : { url: photos[0]?.url ?? null, attribution: photos[0]?.attribution ?? [] });
  } catch (error) {
    if (error instanceof PlacesBudgetExceededError) {
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ error: error.message });
      return;
    }
    req.log.error({ err: error, placeId }, "Restaurant photo lookup failed");
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Restaurant photos are temporarily unavailable." });
  }
}

router.get("/photo/:placeId", async (req, res): Promise<void> => { await servePhotos(req, res, false); });
router.get("/photos/:placeId", async (req, res): Promise<void> => { await servePhotos(req, res, true); });

export default router;