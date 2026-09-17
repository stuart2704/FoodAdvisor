import { Router, type IRouter } from "express";
import { z } from "zod";

const router: IRouter = Router();

const CuisineParams = z.object({
  cuisine: z.string().trim().min(1).max(80),
});

const IMAGE_BASE = "https://images.unsplash.com";
const IMAGES: Record<string, string> = {
  italian: `${IMAGE_BASE}/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1200&q=80`,
  japanese: `${IMAGE_BASE}/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=1200&q=80`,
  mexican: `${IMAGE_BASE}/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=1200&q=80`,
  indian: `${IMAGE_BASE}/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=1200&q=80`,
};
const FALLBACK =
  `${IMAGE_BASE}/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80`;

router.get(
  ["/ai-photo/:cuisine", "/cuisine-image/:cuisine"],
  (req, res) => {
    const parsed = CuisineParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Invalid cuisine.",
      });
      return;
    }
    const cuisine = parsed.data.cuisine.toLocaleLowerCase("en-GB");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({
      success: true,
      cuisine,
      url: IMAGES[cuisine] ?? FALLBACK,
      generated: false,
      source: "curated",
    });
  },
);

export default router;