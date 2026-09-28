import { Router, type IRouter } from "express";
import { z } from "zod";
import { PlacesBudgetExceededError } from "../lib/budgetedPlacesFetch";
import { getPlacePhotos } from "../lib/placePhotoLookup";
import { db, restaurantsTable, restaurantPhotosTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
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
  let ownerPhotos: { url: string; attribution: [] }[] = [];
  try {
    // Authorize on every request, even when provider data is cached.
    const [restaurant] = await db.select({
      sourceName: restaurantsTable.sourceName,
      sourceAttribution: restaurantsTable.sourceAttribution,
      published: restaurantsTable.published,
    }).from(restaurantsTable).where(eq(restaurantsTable.placeId, placeId)).limit(1);
    if (!restaurant?.published) { res.status(404).json({ error: "Restaurant not found." }); return; }
    const owners = await db.select({ id: restaurantPhotosTable.id }).from(restaurantPhotosTable)
      .where(and(eq(restaurantPhotosTable.restaurantId, placeId), eq(restaurantPhotosTable.status, "approved")))
      .orderBy(asc(restaurantPhotosTable.createdAt)).limit(6);
    ownerPhotos = owners.map(p => ({ url: `/api/storage/objects/restaurant/${p.id}`, attribution: [] }));
    if (ownerPhotos.length && (!gallery || ownerPhotos.length >= 6)) {
      res.setHeader("Cache-Control", "no-store");
      res.json(gallery ? { photos: ownerPhotos } : { ...ownerPhotos[0], source: "owner" });
      return;
    }
    const access = checkGooglePhotoAccess(placeId, restaurant);
    if (!access.allowed) {
      if (ownerPhotos.length) {
        res.setHeader("Cache-Control", "no-store");
        res.json({ photos: ownerPhotos });
      } else res.status(access.status).json(access.body);
      return;
    }
    // Gallery can use existing Google photos to fill remaining slots; primary owner
    // photo above never triggers a Google lookup.
  } catch {
    res.status(503).json({ error: "Restaurant photo provider could not be determined." });
    return;
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    if (ownerPhotos.length) res.json({ photos: ownerPhotos });
    else res.status(503).json({ error: "Google Places photos are not configured." });
    return;
  }
  try {
    const photos = await getPlacePhotos(placeId, apiKey, gallery ? 6 - ownerPhotos.length : 1);
    // Server cache is bounded by the provider TTL. Browser caches cannot know how
    // much TTL remains on a cached URI, and must not bypass the publication check.
    res.setHeader("Cache-Control", "no-store");
    res.json(gallery ? { photos: [...ownerPhotos, ...photos] } : { url: photos[0]?.url ?? null, attribution: photos[0]?.attribution ?? [] });
  } catch (error) {
    if (error instanceof PlacesBudgetExceededError) {
      res.setHeader("Cache-Control", "no-store");
      if (ownerPhotos.length) res.json({ photos: ownerPhotos });
      else res.status(503).json({ error: error.message });
      return;
    }
    req.log.error({ err: error, placeId }, "Restaurant photo lookup failed");
    res.setHeader("Cache-Control", "no-store");
    if (ownerPhotos.length) res.json({ photos: ownerPhotos });
    else res.status(502).json({ error: "Restaurant photos are temporarily unavailable." });
  }
}

router.get("/photo/:placeId", async (req, res): Promise<void> => { await servePhotos(req, res, false); });
router.get("/photos/:placeId", async (req, res): Promise<void> => { await servePhotos(req, res, true); });

export default router;