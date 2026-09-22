import { Router, type IRouter } from "express";
import { z } from "zod";

const router: IRouter = Router();
const CACHE_TTL_MS = 60 * 60 * 1000;
const photoCache = new Map<string, { url: string | null; expiresAt: number }>();
const galleryCache = new Map<
  string,
  { photos: string[]; expiresAt: number }
>();

const PlaceParams = z.object({
  placeId: z.string().trim().min(1).max(300),
});

type PlaceDetailsResponse = {
  photos?: Array<{ name?: string }>;
};

type PhotoMediaResponse = {
  photoUri?: string;
};

router.get("/photo/:placeId", async (req, res): Promise<void> => {
  const parsed = PlaceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid place ID." });
    return;
  }

  const { placeId } = parsed.data;
  const cached = photoCache.get(placeId);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ url: cached.url });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Google Places photos are not configured." });
    return;
  }

  try {
    const detailsResponse = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "photos",
        },
      },
    );

    if (!detailsResponse.ok) {
      const message = await detailsResponse.text();
      req.log.warn(
        { placeId, status: detailsResponse.status, message },
        "Google Places photo details request failed",
      );
      res.status(502).json({ error: "Restaurant photo is temporarily unavailable." });
      return;
    }

    const details = (await detailsResponse.json()) as PlaceDetailsResponse;
    const photoName = details.photos?.[0]?.name;
    if (!photoName) {
      photoCache.set(placeId, {
        url: null,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({ url: null });
      return;
    }

    const mediaResponse = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200&skipHttpRedirect=true`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
        },
      },
    );

    if (!mediaResponse.ok) {
      const message = await mediaResponse.text();
      req.log.warn(
        { placeId, status: mediaResponse.status, message },
        "Google Places photo media request failed",
      );
      res.status(502).json({ error: "Restaurant photo is temporarily unavailable." });
      return;
    }

    const media = (await mediaResponse.json()) as PhotoMediaResponse;
    const url = typeof media.photoUri === "string" ? media.photoUri : null;
    photoCache.set(placeId, {
      url,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ url });
  } catch (error) {
    req.log.error({ err: error, placeId }, "Restaurant photo lookup failed");
    res.status(502).json({ error: "Restaurant photo is temporarily unavailable." });
  }
});

router.get("/photos/:placeId", async (req, res): Promise<void> => {
  const parsed = PlaceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid place ID." });
    return;
  }

  const { placeId } = parsed.data;
  const cached = galleryCache.get(placeId);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ photos: cached.photos });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Google Places photos are not configured." });
    return;
  }

  try {
    const detailsResponse = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "photos",
        },
      },
    );

    if (!detailsResponse.ok) {
      const message = await detailsResponse.text();
      req.log.warn(
        { placeId, status: detailsResponse.status, message },
        "Google Places gallery details request failed",
      );
      res.status(502).json({ error: "Restaurant photos are temporarily unavailable." });
      return;
    }

    const details = (await detailsResponse.json()) as PlaceDetailsResponse;
    const photoNames = (details.photos ?? [])
      .map((photo) => photo.name)
      .filter(
        (name): name is string =>
          typeof name === "string" && name.startsWith("places/"),
      )
      .slice(0, 6);

    const photos = (
      await Promise.all(
        photoNames.map(async (photoName) => {
          const mediaResponse = await fetch(
            `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200&skipHttpRedirect=true`,
            {
              headers: {
                "X-Goog-Api-Key": apiKey,
              },
            },
          );
          if (!mediaResponse.ok) return null;
          const media = (await mediaResponse.json()) as PhotoMediaResponse;
          return typeof media.photoUri === "string" ? media.photoUri : null;
        }),
      )
    ).filter((url): url is string => typeof url === "string");

    galleryCache.set(placeId, {
      photos,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ photos });
  } catch (error) {
    req.log.error({ err: error, placeId }, "Restaurant gallery lookup failed");
    res.status(502).json({ error: "Restaurant photos are temporarily unavailable." });
  }
});

export default router;