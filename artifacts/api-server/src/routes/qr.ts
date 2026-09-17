import { db, restaurantsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { cache } from "../lib/cache";

const router: IRouter = Router();

const RestaurantParams = z.object({
  id: z.string().trim().min(1).max(255),
});

router.get(["/qr/:id", "/qrcode/:id"], async (req, res) => {
  const parsed = RestaurantParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant ID." });
    return;
  }
  try {
    const [restaurant] = await db
      .select({
        id: restaurantsTable.placeId,
        slug: restaurantsTable.slug,
      })
      .from(restaurantsTable)
      .where(
        or(
          eq(restaurantsTable.placeId, parsed.data.id),
          eq(restaurantsTable.slug, parsed.data.id),
        ),
      )
      .limit(1);
    if (!restaurant) {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    const cacheKey = `qr:${restaurant.id}:${restaurant.slug ?? ""}`;
    const cached = cache.get<string>(cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ success: true, qr: cached });
      return;
    }
    const path = restaurant.slug
      ? `/restaurants/${encodeURIComponent(restaurant.slug)}`
      : `/restaurant/${encodeURIComponent(restaurant.id)}`;
    const url = new URL(path, "https://thefoodadvisor.co.uk").toString();
    const qr = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
    });
    cache.set(cacheKey, qr);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, qr, url });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant QR generation failed");
    res.status(503).json({
      success: false,
      error: "The QR code is temporarily unavailable.",
    });
  }
});

export default router;