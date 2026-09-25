import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import { getRestaurantProfile } from "../services/restaurantProfileEngine";
import { db, restaurantProfileViewEventsTable, restaurantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { adminOnly } from "../middleware/adminOnly";
import { restaurantSlug } from "../utils/slugify";
import { logEvent } from "../services/analyticsEngine";
import { preserveVanishedLocation } from "../utils/locationAliases";
import { asc, isNotNull, sql } from "drizzle-orm";
import { cache } from "../lib/cache";

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
    const restaurant = await db.transaction(async (tx) => {
      // Serialize location updates so the final restaurant leaving a name
      // cannot race another rename and lose its former canonical slug.
      if (body.data.city !== undefined || body.data.region !== undefined) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(734662, 1)`);
      }
      const [existing] = await tx
        .select({
          placeId: restaurantsTable.placeId,
          name: restaurantsTable.name,
          city: restaurantsTable.city,
          region: restaurantsTable.region,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.slug, slug.data))
        .limit(1);
      if (!existing) return null;
      const oldCities = body.data.city !== undefined && body.data.city !== existing.city
        ? await tx.selectDistinct({ name: restaurantsTable.city }).from(restaurantsTable)
          .orderBy(asc(restaurantsTable.city)).limit(1_000)
        : [];
      const oldRegions = body.data.region !== undefined && body.data.region !== existing.region
        ? await tx.selectDistinct({ name: restaurantsTable.region }).from(restaurantsTable)
          .where(isNotNull(restaurantsTable.region)).orderBy(asc(restaurantsTable.region)).limit(1_000)
        : [];
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
    const [updated] = await tx
      .update(restaurantsTable)
      .set(values)
      .where(eq(restaurantsTable.placeId, existing.placeId))
      .returning({
        id: restaurantsTable.placeId,
        slug: restaurantsTable.slug,
        name: restaurantsTable.name,
      });
      await preserveVanishedLocation(tx, "city", existing.city, body.data.city ?? existing.city,
        oldCities.map(row => row.name));
      await preserveVanishedLocation(tx, "region", existing.region, body.data.region === undefined
        ? existing.region : body.data.region, oldRegions.flatMap(row => row.name ? [row.name] : []));
      return updated;
    });
    if (!restaurant) {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    if (body.data.city !== undefined) cache.del("cities");
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
      await logEvent(data.id, "profile_view", { source: "server_profile" });
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
    .where(and(
      eq(restaurantsTable.slug, parsed.data.slug),
      eq(restaurantsTable.published, true),
    ))
    .limit(1);
  if (!restaurant) {
    res.status(404).json({ success: false, error: "Restaurant not found." });
    return;
  }
  await serveRestaurantProfile(req, res, restaurant.placeId);
});

export default router;