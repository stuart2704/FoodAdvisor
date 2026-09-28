import { Router, type IRouter } from "express";
import { db, restaurantPhotoDeletionQueueTable, restaurantPhotoIntentsTable, restaurantPhotosTable, restaurantsTable } from "@workspace/db";
import { and, asc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { validateToken } from "../services/portalTokenService";
import { adminOnly } from "../middleware/adminOnly";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, createPhotoPath, signPhotoUpload, streamPhoto, verifyPhoto } from "../lib/restaurantPhotoStorage";

const router: IRouter = Router();
const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const idSchema = tokenSchema.extend({ photoId: z.string().uuid() });
const photoSchema = z.object({
  contentType: z.enum(PHOTO_TYPES), sizeBytes: z.number().int().positive().max(PHOTO_MAX_BYTES),
}).strict();
const finalizeSchema = photoSchema.extend({
  objectPath: z.string().regex(/^\/objects\/restaurant\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/),
}).strict();
const adminIdSchema = z.object({ photoId: z.string().uuid() });

async function ownerId(token: string) {
  const id = await validateToken(token);
  if (!id) return null;
  const [restaurant] = await db.select({ claimedAt: restaurantsTable.claimedAt })
    .from(restaurantsTable).where(eq(restaurantsTable.placeId, id)).limit(1);
  return restaurant?.claimedAt ? id : null;
}
function privateResponse(res: import("express").Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
}
function deny(res: import("express").Response) {
  res.status(404).json({ success: false, error: "Invalid or expired owner link." });
}

router.get("/portal/:token/photos", async (req, res): Promise<void> => {
  privateResponse(res);
  const params = tokenSchema.safeParse(req.params);
  const id = params.success && await ownerId(params.data.token);
  if (!id) { deny(res); return; }
  const photos = await db.select().from(restaurantPhotosTable)
    .where(eq(restaurantPhotosTable.restaurantId, id)).orderBy(asc(restaurantPhotosTable.createdAt));
  res.json({ success: true, photos: photos.map(p => ({
    id: p.id, status: p.status, createdAt: p.createdAt,
    url: `/api/portal/${params.data.token}/photos/${p.id}/image`,
  })) });
});

router.post("/portal/:token/photos/upload-intent", async (req, res): Promise<void> => {
  privateResponse(res);
  const params = tokenSchema.safeParse(req.params);
  const body = photoSchema.safeParse(req.body);
  if (!params.success) { deny(res); return; }
  const id = await ownerId(params.data.token);
  if (!id) { deny(res); return; }
  if (!body.success) { res.status(400).json({ error: "Only JPEG, PNG, or WebP images up to 5 MiB are accepted." }); return; }
  const [counts] = await db.select({ count: sql<number>`count(*)::int` }).from(restaurantPhotosTable)
    .where(eq(restaurantPhotosTable.restaurantId, id));
  const active = await db.select({ id: restaurantPhotoIntentsTable.id }).from(restaurantPhotoIntentsTable)
    .where(and(eq(restaurantPhotoIntentsTable.restaurantId, id), gt(restaurantPhotoIntentsTable.expiresAt, new Date()), isNull(restaurantPhotoIntentsTable.consumedAt))).limit(3);
  const [daily] = await db.select({ count: sql<number>`count(*)::int` }).from(restaurantPhotoIntentsTable)
    .where(and(eq(restaurantPhotoIntentsTable.restaurantId, id), gte(restaurantPhotoIntentsTable.createdAt, new Date(Date.now() - 24 * 60 * 60_000))));
  if (counts.count + active.length >= 10 || active.length >= 3 || daily.count >= 20) {
    res.status(429).json({ error: "Photo upload limit reached (10 photos, 3 at a time, 20 attempts per day)." }); return;
  }
  const objectPath = createPhotoPath();
  try {
    const uploadUrl = await signPhotoUpload(objectPath);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await db.insert(restaurantPhotoIntentsTable).values({
      restaurantId: id, objectPath, contentType: body.data.contentType,
      sizeBytes: body.data.sizeBytes, expiresAt,
      cleanupAfter: new Date(expiresAt.getTime() + 15 * 60_000),
    });
    res.status(201).json({ success: true, uploadUrl, objectPath, uploadMethod: "PUT", uploadHeaders: { "Content-Type": body.data.contentType } });
  } catch (error) {
    req.log.warn({ err: error }, "Restaurant photo upload signing failed");
    res.status(503).json({ error: "Photo uploads are temporarily unavailable." });
  }
});

router.post("/portal/:token/photos/finalize", async (req, res): Promise<void> => {
  privateResponse(res);
  const params = tokenSchema.safeParse(req.params);
  const body = finalizeSchema.safeParse(req.body);
  if (!params.success) { deny(res); return; }
  const id = await ownerId(params.data.token);
  if (!id) { deny(res); return; }
  if (!body.success) { res.status(400).json({ error: "Invalid photo upload." }); return; }
  const [intent] = await db.update(restaurantPhotoIntentsTable).set({ consumedAt: new Date() }).where(and(
    eq(restaurantPhotoIntentsTable.restaurantId, id),
    eq(restaurantPhotoIntentsTable.objectPath, body.data.objectPath),
    eq(restaurantPhotoIntentsTable.contentType, body.data.contentType),
    eq(restaurantPhotoIntentsTable.sizeBytes, body.data.sizeBytes),
    isNull(restaurantPhotoIntentsTable.consumedAt), gt(restaurantPhotoIntentsTable.expiresAt, new Date()),
  )).returning();
  if (!intent) { res.status(400).json({ error: "Invalid, expired, or used upload." }); return; }
  try {
    const generation = await verifyPhoto(intent.objectPath, body.data.contentType, body.data.sizeBytes);
    // Serialize concurrent finalizations and removals for this restaurant.
    const photo = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`restaurant-photos:${id}`}, 72))`);
      const [counts] = await tx.select({ count: sql<number>`count(*)::int` }).from(restaurantPhotosTable)
        .where(eq(restaurantPhotosTable.restaurantId, id));
      if (counts.count >= 10) return null;
      const [saved] = await tx.insert(restaurantPhotosTable).values({
        restaurantId: id, objectPath: intent.objectPath, generation, contentType: intent.contentType, sizeBytes: intent.sizeBytes,
      }).returning();
      return saved;
    });
    if (!photo) { res.status(429).json({ error: "Photo limit reached." }); return; }
    res.status(201).json({ success: true, photo: { id: photo.id, status: photo.status } });
  } catch (error) {
    req.log.warn({ err: error }, "Restaurant photo verification failed");
    res.status(400).json({ error: "The uploaded image could not be verified." });
  }
});

router.get("/portal/:token/photos/:photoId/image", async (req, res): Promise<void> => {
  privateResponse(res);
  const params = idSchema.safeParse(req.params);
  const id = params.success && await ownerId(params.data.token);
  if (!id) { deny(res); return; }
  const [photo] = await db.select().from(restaurantPhotosTable).where(and(
    eq(restaurantPhotosTable.id, params.data.photoId), eq(restaurantPhotosTable.restaurantId, id),
  )).limit(1);
  if (!photo) { res.status(404).end(); return; }
  await streamPhoto(photo.objectPath, photo.generation, res);
});

router.delete("/portal/:token/photos/:photoId", async (req, res): Promise<void> => {
  privateResponse(res);
  const params = idSchema.safeParse(req.params);
  const id = params.success && await ownerId(params.data.token);
  if (!id) { deny(res); return; }
  const photo = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`restaurant-photos:${id}`}, 72))`);
    const [removed] = await tx.delete(restaurantPhotosTable).where(and(
      eq(restaurantPhotosTable.id, params.data.photoId), eq(restaurantPhotosTable.restaurantId, id),
    )).returning();
    if (removed) await tx.insert(restaurantPhotoDeletionQueueTable).values({
      objectPath: removed.objectPath, dueAt: new Date(Date.now() + 20 * 60_000),
    }).onConflictDoNothing();
    return removed;
  });
  if (!photo) { res.status(404).json({ error: "Photo not found." }); return; }
  res.json({ success: true });
});

router.get("/admin/restaurant-photos/pending", adminOnly, async (_req, res): Promise<void> => {
  const photos = await db.select({
    id: restaurantPhotosTable.id, restaurantId: restaurantPhotosTable.restaurantId,
    name: restaurantsTable.name, createdAt: restaurantPhotosTable.createdAt,
  }).from(restaurantPhotosTable).innerJoin(restaurantsTable, eq(restaurantsTable.placeId, restaurantPhotosTable.restaurantId))
    .where(eq(restaurantPhotosTable.status, "pending")).orderBy(asc(restaurantPhotosTable.createdAt)).limit(100);
  res.json({ photos });
});
router.get("/admin/restaurant-photos/:photoId/image", adminOnly, async (req, res): Promise<void> => {
  const params = adminIdSchema.safeParse(req.params);
  if (!params.success) { res.status(404).end(); return; }
  privateResponse(res);
  const [photo] = await db.select().from(restaurantPhotosTable).where(eq(restaurantPhotosTable.id, params.data.photoId)).limit(1);
  if (!photo) { res.status(404).end(); return; }
  await streamPhoto(photo.objectPath, photo.generation, res);
});
router.post("/admin/restaurant-photos/:photoId/:decision", adminOnly, async (req, res): Promise<void> => {
  const params = adminIdSchema.extend({ decision: z.enum(["approve", "reject"]) }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid decision." }); return; }
  const [photo] = await db.update(restaurantPhotosTable).set({
    status: params.data.decision === "approve" ? "approved" : "rejected",
  }).where(and(eq(restaurantPhotosTable.id, params.data.photoId), eq(restaurantPhotosTable.status, "pending"))).returning();
  if (!photo) { res.status(404).json({ error: "Pending photo not found." }); return; }
  res.json({ success: true });
});

router.get("/storage/objects/restaurant/:photoId", async (req, res): Promise<void> => {
  const params = adminIdSchema.safeParse(req.params);
  if (!params.success) { res.status(404).end(); return; }
  const [photo] = await db.select({ objectPath: restaurantPhotosTable.objectPath, generation: restaurantPhotosTable.generation }).from(restaurantPhotosTable)
    .innerJoin(restaurantsTable, eq(restaurantsTable.placeId, restaurantPhotosTable.restaurantId))
    .where(and(eq(restaurantPhotosTable.id, params.data.photoId), eq(restaurantPhotosTable.status, "approved"), eq(restaurantsTable.published, true))).limit(1);
  if (!photo) { res.status(404).end(); return; }
  await streamPhoto(photo.objectPath, photo.generation, res, "public, no-store");
});
export default router;