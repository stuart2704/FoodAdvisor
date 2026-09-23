import { db, restaurantChefProfilesTable, restaurantsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";
import { deleteChefObject } from "../lib/chefObjectStorage";
import { streamChefObject } from "../lib/chefObjectStorage";

const router: IRouter = Router();
const placeIdParams = z.object({ placeId: z.string().trim().min(1).max(512) });
const chefBody = z.object({
  name: z.string().trim().min(1).max(120).nullable(),
  bio: z.string().trim().max(2_000).nullable(),
  philosophy: z.string().trim().max(1_000).nullable(),
  awards: z.array(z.string().trim().min(1).max(240)).max(8),
  awardEvidenceUrls: z.array(z.string().trim().url().max(2_048)).max(8),
  signatureDishes: z.array(z.string().trim().min(1).max(180)).max(12),
  dishEvidenceUrls: z.array(z.string().trim().url().max(2_048)).max(12),
  photoObjectPath: z.string().regex(/^\/objects\/chef\/[0-9a-f-]{36}$/).nullable().optional(),
  photoMimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).nullable().optional(),
  photoSizeBytes: z.number().int().positive().max(5 * 1024 * 1024).nullable().optional(),
}).strict();
const decisionBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

router.get("/chef-profiles/:placeId/photo", adminOnly, async (req, res): Promise<void> => {
  const params = placeIdParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ success: false, error: "Invalid restaurant." }); return; }
  const [profile] = await db.select({ photoObjectPath: restaurantChefProfilesTable.photoObjectPath })
    .from(restaurantChefProfilesTable)
    .where(eq(restaurantChefProfilesTable.restaurantId, params.data.placeId)).limit(1);
  if (!profile?.photoObjectPath) { res.status(404).json({ error: "Object not found." }); return; }
  await streamChefObject(profile.photoObjectPath, res, "private, no-store");
});

router.get("/chef-profiles/pending", adminOnly, async (_req, res): Promise<void> => {
  const profiles = await db
    .select({
      restaurantId: restaurantChefProfilesTable.restaurantId,
      restaurantName: restaurantsTable.name,
      name: restaurantChefProfilesTable.name,
      bio: restaurantChefProfilesTable.bio,
      philosophy: restaurantChefProfilesTable.philosophy,
      awards: restaurantChefProfilesTable.awards,
      awardEvidenceUrls: restaurantChefProfilesTable.awardEvidenceUrls,
      signatureDishes: restaurantChefProfilesTable.signatureDishes,
      dishEvidenceUrls: restaurantChefProfilesTable.dishEvidenceUrls,
      photoObjectPath: restaurantChefProfilesTable.photoObjectPath,
      photoMimeType: restaurantChefProfilesTable.photoMimeType,
      photoSizeBytes: restaurantChefProfilesTable.photoSizeBytes,
      moderationStatus: restaurantChefProfilesTable.moderationStatus,
      rejectionReason: restaurantChefProfilesTable.rejectionReason,
      updatedAt: restaurantChefProfilesTable.updatedAt,
    })
    .from(restaurantChefProfilesTable)
    .innerJoin(restaurantsTable, eq(restaurantsTable.placeId, restaurantChefProfilesTable.restaurantId))
    .where(eq(restaurantChefProfilesTable.moderationStatus, "pending"))
    .orderBy(asc(restaurantChefProfilesTable.updatedAt));
  res.json({ success: true, profiles });
});

router.put("/chef-profiles/:placeId", adminOnly, async (req, res): Promise<void> => {
  const params = placeIdParams.safeParse(req.params);
  const body = chefBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ success: false, error: "Invalid chef profile." });
    return;
  }
  const [restaurant] = await db.select({ placeId: restaurantsTable.placeId }).from(restaurantsTable).where(eq(restaurantsTable.placeId, params.data.placeId)).limit(1);
  if (!restaurant) {
    res.status(404).json({ success: false, error: "Restaurant not found." });
    return;
  }
  const [existing] = await db.select().from(restaurantChefProfilesTable).where(eq(restaurantChefProfilesTable.restaurantId, params.data.placeId)).limit(1);
  const values = {
    restaurantId: params.data.placeId,
    ...body.data,
    photoObjectPath: body.data.photoObjectPath ?? existing?.photoObjectPath ?? null,
    photoMimeType: body.data.photoMimeType ?? existing?.photoMimeType ?? null,
    photoSizeBytes: body.data.photoSizeBytes ?? existing?.photoSizeBytes ?? null,
    moderationStatus: "pending",
    verifiedAt: null,
    reviewedBy: null,
    rejectionReason: null,
  } as const;
  const [profile] = existing
    ? await db.update(restaurantChefProfilesTable).set(values).where(eq(restaurantChefProfilesTable.restaurantId, params.data.placeId)).returning()
    : await db.insert(restaurantChefProfilesTable).values(values).returning();
  if (existing?.photoObjectPath && existing.photoObjectPath !== profile?.photoObjectPath) {
    try { await deleteChefObject(existing.photoObjectPath); } catch (error) {
      req.log.warn({ err: error }, "Previous chef photo cleanup failed");
    }
  }
  res.json({ success: true, profile });
});

router.post("/chef-profiles/:placeId/approve", adminOnly, async (req, res): Promise<void> => {
  const params = placeIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant." });
    return;
  }
  const reviewer = String(req.session?.admin ?? "admin");
  const [profile] = await db.update(restaurantChefProfilesTable).set({
    moderationStatus: "approved",
    verifiedAt: new Date(),
    reviewedBy: reviewer,
    rejectionReason: null,
  }).where(and(eq(restaurantChefProfilesTable.restaurantId, params.data.placeId), eq(restaurantChefProfilesTable.moderationStatus, "pending"))).returning();
  if (!profile) {
    res.status(404).json({ success: false, error: "Pending chef profile not found." });
    return;
  }
  res.json({ success: true, profile });
});

router.post("/chef-profiles/:placeId/reject", adminOnly, async (req, res): Promise<void> => {
  const params = placeIdParams.safeParse(req.params);
  const body = decisionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ success: false, error: "Invalid rejection." });
    return;
  }
  const [profile] = await db.update(restaurantChefProfilesTable).set({
    moderationStatus: "rejected",
    verifiedAt: null,
    reviewedBy: String(req.session?.admin ?? "admin"),
    rejectionReason: body.data.reason ?? "This profile needs more evidence.",
  }).where(eq(restaurantChefProfilesTable.restaurantId, params.data.placeId)).returning();
  if (!profile) {
    res.status(404).json({ success: false, error: "Chef profile not found." });
    return;
  }
  res.json({ success: true, profile });
});

router.delete("/chef-profiles/:placeId", adminOnly, async (req, res): Promise<void> => {
  const params = placeIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant." });
    return;
  }
  const [existing] = await db.select({ photoObjectPath: restaurantChefProfilesTable.photoObjectPath })
    .from(restaurantChefProfilesTable)
    .where(eq(restaurantChefProfilesTable.restaurantId, params.data.placeId)).limit(1);
  await db.delete(restaurantChefProfilesTable).where(eq(restaurantChefProfilesTable.restaurantId, params.data.placeId));
  if (existing?.photoObjectPath) {
    try { await deleteChefObject(existing.photoObjectPath); } catch (error) {
      req.log.warn({ err: error }, "Chef photo cleanup failed");
    }
  }
  res.json({ success: true });
});

export default router;