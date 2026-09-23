import { randomUUID } from "node:crypto";
import {
  db,
  restaurantCollectionMembersTable,
  restaurantCollectionsTable,
  restaurantsTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  curatorIdentity,
  curatorOnly,
  type CuratorIdentity,
} from "../middleware/curatorOnly";

const router: IRouter = Router();
const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const CollectionParams = z.object({
  id: z.string().uuid(),
});
const CollectionQuery = z.object({
  city: z.string().trim().min(1).max(100).optional(),
});
const RestaurantIds = z
  .array(z.string().trim().min(1).max(512))
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, "Restaurant IDs must be unique.");
const CreateCollectionBody = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000),
  city: z.string().trim().min(1).max(100),
  restaurantIds: RestaurantIds,
});
const UpdateCollectionBody = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(1_000).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    restaurantIds: RestaurantIds.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "At least one update is required.");
const ReorderCollectionBody = z.object({ restaurantIds: RestaurantIds });

type Database = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function validateRestaurants(
  executor: typeof db | Database,
  city: string,
  restaurantIds: string[],
): Promise<boolean> {
  const rows = await executor
    .select({ id: restaurantsTable.placeId, city: restaurantsTable.city })
    .from(restaurantsTable)
    .where(inArray(restaurantsTable.placeId, restaurantIds));
  const expectedCity = city.toLocaleLowerCase("en-GB");
  return (
    rows.length === restaurantIds.length &&
    rows.every((row) => row.city.toLocaleLowerCase("en-GB") === expectedCity)
  );
}

async function replaceMembers(
  tx: Database,
  collectionId: string,
  restaurantIds: string[],
): Promise<void> {
  await tx
    .delete(restaurantCollectionMembersTable)
    .where(eq(restaurantCollectionMembersTable.collectionId, collectionId));
  await tx.insert(restaurantCollectionMembersTable).values(
    restaurantIds.map((restaurantId, position) => ({
      id: randomUUID(),
      collectionId,
      restaurantId,
      position,
    })),
  );
}

async function findEditableCollection(
  id: string,
  identity: CuratorIdentity,
) {
  const [collection] = await db
    .select()
    .from(restaurantCollectionsTable)
    .where(
      identity.isAdmin
        ? eq(restaurantCollectionsTable.id, id)
        : and(
            eq(restaurantCollectionsTable.id, id),
            eq(restaurantCollectionsTable.curatorUserId, identity.userId),
          ),
    )
    .limit(1);
  return collection ?? null;
}

async function readCollections(city?: string) {
  const rows = await db
    .select({
      id: restaurantCollectionsTable.id,
      title: restaurantCollectionsTable.title,
      description: restaurantCollectionsTable.description,
      city: restaurantCollectionsTable.city,
      updatedAt: restaurantCollectionsTable.updatedAt,
      memberId: restaurantCollectionMembersTable.id,
      position: restaurantCollectionMembersTable.position,
      restaurantId: restaurantsTable.placeId,
      restaurantSlug: restaurantsTable.slug,
      restaurantName: restaurantsTable.name,
      restaurantCity: restaurantsTable.city,
      cuisineTags: restaurantsTable.cuisineTags,
      rating: restaurantsTable.rating,
      premium: restaurantsTable.premium,
    })
    .from(restaurantCollectionsTable)
    .innerJoin(
      restaurantCollectionMembersTable,
      eq(
        restaurantCollectionMembersTable.collectionId,
        restaurantCollectionsTable.id,
      ),
    )
    .innerJoin(
      restaurantsTable,
      eq(restaurantCollectionMembersTable.restaurantId, restaurantsTable.placeId),
    )
    .where(city ? eq(restaurantCollectionsTable.city, city) : undefined)
    .orderBy(
      asc(restaurantCollectionsTable.city),
      asc(restaurantCollectionsTable.title),
      asc(restaurantCollectionMembersTable.position),
    );

  const collections = new Map<
    string,
    {
      id: string;
      title: string;
      description: string;
      city: string;
      updatedAt: Date;
      restaurants: Array<{
        membershipId: string;
        id: string;
        slug: string | null;
        name: string;
        city: string;
        cuisine: string | null;
        rating: number | null;
        premium: boolean;
      }>;
    }
  >();
  for (const row of rows) {
    let collection = collections.get(row.id);
    if (!collection) {
      collection = {
        id: row.id,
        title: row.title,
        description: row.description,
        city: row.city,
        updatedAt: row.updatedAt,
        restaurants: [],
      };
      collections.set(row.id, collection);
    }
    collection.restaurants.push({
      membershipId: row.memberId,
      id: row.restaurantId,
      slug: row.restaurantSlug,
      name: row.restaurantName,
      city: row.restaurantCity,
      cuisine: row.cuisineTags[0] ?? null,
      rating: row.rating,
      premium: row.premium,
    });
  }
  return [...collections.values()];
}

router.get("/collections", async (req, res): Promise<void> => {
  const parsed = CollectionQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid city filter." });
    return;
  }
  try {
    const data = await readCollections(parsed.data.city);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "Collection query failed");
    res.status(503).json({ success: false, error: "Collections are unavailable." });
  }
});

router.post(
  "/collections",
  writeLimiter,
  curatorOnly,
  async (req, res): Promise<void> => {
    const parsed = CreateCollectionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Collection details are invalid." });
      return;
    }
    const identity = res.locals.curator as CuratorIdentity;
    try {
      const id = randomUUID();
      const valid = await validateRestaurants(
        db,
        parsed.data.city,
        parsed.data.restaurantIds,
      );
      if (!valid) {
        res.status(400).json({
          success: false,
          error: "Every restaurant must exist and belong to the collection city.",
        });
        return;
      }
      await db.transaction(async (tx) => {
        await tx.insert(restaurantCollectionsTable).values({
          id,
          title: parsed.data.title,
          description: parsed.data.description,
          city: parsed.data.city,
          curatorUserId: identity.userId,
        });
        await replaceMembers(tx, id, parsed.data.restaurantIds);
      });
      const [data] = (await readCollections()).filter((item) => item.id === id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      req.log.error({ err: error }, "Collection creation failed");
      res.status(503).json({ success: false, error: "Collection could not be created." });
    }
  },
);

router.patch(
  "/collections/:id",
  writeLimiter,
  curatorOnly,
  async (req, res): Promise<void> => {
    const params = CollectionParams.safeParse(req.params);
    const body = UpdateCollectionBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ success: false, error: "Collection updates are invalid." });
      return;
    }
    const identity = curatorIdentity(req)!;
    try {
      const existing = await findEditableCollection(params.data.id, identity);
      if (!existing) {
        res.status(404).json({ success: false, error: "Collection not found." });
        return;
      }
      const city = body.data.city ?? existing.city;
      let restaurantIds = body.data.restaurantIds;
      if (!restaurantIds && body.data.city) {
        restaurantIds = (
          await db
            .select({ id: restaurantCollectionMembersTable.restaurantId })
            .from(restaurantCollectionMembersTable)
            .where(eq(restaurantCollectionMembersTable.collectionId, existing.id))
            .orderBy(asc(restaurantCollectionMembersTable.position))
        ).map((row) => row.id);
      }
      if (
        restaurantIds &&
        !(await validateRestaurants(db, city, restaurantIds))
      ) {
        res.status(400).json({
          success: false,
          error: "Every restaurant must exist and belong to the collection city.",
        });
        return;
      }
      await db.transaction(async (tx) => {
        await tx
          .update(restaurantCollectionsTable)
          .set({
            ...(body.data.title ? { title: body.data.title } : {}),
            ...(body.data.description
              ? { description: body.data.description }
              : {}),
            ...(body.data.city ? { city: body.data.city } : {}),
            updatedAt: new Date(),
          })
          .where(eq(restaurantCollectionsTable.id, existing.id));
        if (body.data.restaurantIds) {
          await replaceMembers(tx, existing.id, body.data.restaurantIds);
        }
      });
      const [data] = (await readCollections()).filter((item) => item.id === existing.id);
      res.json({ success: true, data });
    } catch (error) {
      req.log.error({ err: error }, "Collection update failed");
      res.status(503).json({ success: false, error: "Collection could not be updated." });
    }
  },
);

router.put(
  "/collections/:id/restaurants",
  writeLimiter,
  curatorOnly,
  async (req, res): Promise<void> => {
    const params = CollectionParams.safeParse(req.params);
    const body = ReorderCollectionBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ success: false, error: "Restaurant order is invalid." });
      return;
    }
    const identity = curatorIdentity(req)!;
    try {
      const existing = await findEditableCollection(params.data.id, identity);
      if (!existing) {
        res.status(404).json({ success: false, error: "Collection not found." });
        return;
      }
      const valid = await validateRestaurants(
        db,
        existing.city,
        body.data.restaurantIds,
      );
      if (!valid) {
        res.status(400).json({
          success: false,
          error: "Every restaurant must exist and belong to the collection city.",
        });
        return;
      }
      await db.transaction(async (tx) => {
        await replaceMembers(tx, existing.id, body.data.restaurantIds);
        await tx
          .update(restaurantCollectionsTable)
          .set({ updatedAt: new Date() })
          .where(eq(restaurantCollectionsTable.id, existing.id));
      });
      const [data] = (await readCollections()).filter((item) => item.id === existing.id);
      res.json({ success: true, data });
    } catch (error) {
      req.log.error({ err: error }, "Collection reorder failed");
      res.status(503).json({ success: false, error: "Collection could not be reordered." });
    }
  },
);

router.delete(
  "/collections/:id",
  writeLimiter,
  curatorOnly,
  async (req, res): Promise<void> => {
    const params = CollectionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ success: false, error: "Invalid collection ID." });
      return;
    }
    const identity = curatorIdentity(req)!;
    try {
      const existing = await findEditableCollection(params.data.id, identity);
      if (!existing) {
        res.status(404).json({ success: false, error: "Collection not found." });
        return;
      }
      await db
        .delete(restaurantCollectionsTable)
        .where(eq(restaurantCollectionsTable.id, existing.id));
      res.status(204).send();
    } catch (error) {
      req.log.error({ err: error }, "Collection deletion failed");
      res.status(503).json({ success: false, error: "Collection could not be deleted." });
    }
  },
);

export default router;