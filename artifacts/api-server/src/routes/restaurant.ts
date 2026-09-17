import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import { getRestaurantProfile } from "../services/restaurantProfileEngine";
import { db, restaurantProfileViewEventsTable, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { adminOnly } from "../middleware/adminOnly";
import { restaurantSlug } from "../utils/slugify";
import { logEvent } from "../services/analyticsEngine";

const router: IRouter = Router();

const RestaurantParams = z.object({
  id: z.string().trim().min(1).max(512),
});

const CreateRestaurantBody = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100).nullable().optional(),
  country: z.string().trim().min(1).max(100),
  cuisine: z.string().trim().min(1).max(100).nullable().optional(),
  rating: z.coerce.number().min(0).max(5).nullable().optional(),
  deliveryUrl: z.string().trim().url().max(2048).nullable().optional(),
});

const UpdateRestaurantBody = CreateRestaurantBody.partial().refine(
  (data) => Object.keys(data).length > 0,
  "At least one restaurant field is required.",
);

router.post("/restaurants", adminOnly, async (req, res) => {
  const parsed = CreateRestaurantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: "Restaurant details are invalid.",
    });
    return;
  }
  const placeId = `manual-${randomUUID()}`;
  const slug = restaurantSlug(parsed.data.name, placeId);
  const mapsQuery = encodeURIComponent(
    `${parsed.data.name}, ${parsed.data.address}`,
  );
  try {
    const [restaurant] = await db
      .insert(restaurantsTable)
      .values({
        placeId,
        slug,
        name: parsed.data.name,
        address: parsed.data.address,
        city: parsed.data.city,
        region: parsed.data.region ?? null,
        country: parsed.data.country,
        cuisineTags: parsed.data.cuisine ? [parsed.data.cuisine] : [],
        rating: parsed.data.rating ?? null,
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
      })
      .returning({
        id: restaurantsTable.placeId,
        slug: restaurantsTable.slug,
        name: restaurantsTable.name,
      });
    res.status(201).json({ success: true, data: restaurant });
  } catch (error) {
    req.log.error({ err: error }, "Manual restaurant creation failed");
    res.status(503).json({
      success: false,
      error: "Restaurant could not be created.",
    });
  }
});

router.put("/restaurants/:slug", adminOnly, async (req, res) => {
  const slug = z.string().trim().min(1).max(600).safeParse(req.params.slug);
  const body = UpdateRestaurantBody.safeParse(req.body);
  if (!slug.success || !body.success) {
    res.status(400).json({
      success: false,
      error: "Restaurant updates are invalid.",
    });
    return;
  }
  try {
    const [existing] = await db
      .select({
        placeId: restaurantsTable.placeId,
        name: restaurantsTable.name,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.slug, slug.data))
      .limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    const values = {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.address !== undefined ? { address: body.data.address } : {}),
      ...(body.data.city !== undefined ? { city: body.data.city } : {}),
      ...(body.data.region !== undefined ? { region: body.data.region ?? null } : {}),
      ...(body.data.country !== undefined ? { country: body.data.country } : {}),
      ...(body.data.cuisine !== undefined
        ? { cuisineTags: body.data.cuisine ? [body.data.cuisine] : [] }
        : {}),
      ...(body.data.rating !== undefined ? { rating: body.data.rating ?? null } : {}),
      ...(body.data.deliveryUrl !== undefined
        ? { deliveryUrl: body.data.deliveryUrl ?? null }
        : {}),
      ...(body.data.name !== undefined
        ? { slug: restaurantSlug(body.data.name, existing.placeId) }
        : {}),
    };
    const [restaurant] = await db
      .update(restaurantsTable)
      .set(values)
      .where(eq(restaurantsTable.placeId, existing.placeId))
      .returning({
        id: restaurantsTable.placeId,
        slug: restaurantsTable.slug,
        name: restaurantsTable.name,
      });
    res.json({ success: true, data: restaurant });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant update failed");
    res.status(503).json({
      success: false,
      error: "Restaurant could not be updated.",
    });
  }
});

async function serveRestaurantProfile(
  req: Request,
  res: Response,
  id: string,
) {
  try {
    const data = await getRestaurantProfile(id);
    if (!data) {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    try {
      await db.insert(restaurantProfileViewEventsTable).values({
        placeId: data.id,
        premium: data.premium,
        claimed: data.claimed,
      });
      await logEvent(data.id, "profile_view");
    } catch (error) {
      req.log.warn({ err: error }, "Restaurant profile metric could not be recorded");
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant profile query failed");
    res.status(503).json({
      success: false,
      error: "The restaurant profile is temporarily unavailable.",
    });
  }
}

router.get("/restaurant/:id", async (req, res) => {
  const parsed = RestaurantParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant ID." });
    return;
  }
  await serveRestaurantProfile(req, res, parsed.data.id);
});

router.get("/restaurants/:slug", async (req, res) => {
  const parsed = z.object({
    slug: z.string().trim().min(1).max(600),
  }).safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant slug." });
    return;
  }
  const [restaurant] = await db
    .select({ placeId: restaurantsTable.placeId })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.slug, parsed.data.slug))
    .limit(1);
  if (!restaurant) {
    res.status(404).json({ success: false, error: "Restaurant not found." });
    return;
  }
  await serveRestaurantProfile(req, res, restaurant.placeId);
});

export default router;