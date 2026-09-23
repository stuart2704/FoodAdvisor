import {
  db,
  restaurantEventsTable,
  restaurantOffersTable,
  restaurantChefProfilesTable,
  chefPhotoUploadIntentsTable,
  restaurantsTable,
} from "@workspace/db";
import { and, asc, eq, gte, gt, isNull, lt } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { validateToken } from "../services/portalTokenService";
import { logEvent } from "../services/analyticsEngine";
import { getRestaurantAnalytics } from "../services/analyticsEngine";
import { generateOwnerAnalyticsInsight } from "../services/ownerAnalyticsInsight";
import { recordOwnerLogin } from "../services/personalisationEngine";
import {
  generateSeoCopy,
  generateSocialCopy,
  seoLimiter,
  socialLimiter,
} from "./ai";
import {
  CHEF_IMAGE_MAX_BYTES,
  CHEF_IMAGE_TYPES,
  createChefObjectPath,
  createChefUploadUrl,
  deleteChefObject,
  finalizeChefObject,
  streamChefObject,
} from "../lib/chefObjectStorage";

const router: IRouter = Router();
const tokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const socialMarketingSchema = z
  .object({
    tone: z
      .enum([
        "friendly",
        "professional",
        "premium",
        "casual",
        "playful",
        "energetic",
        "luxury",
        "fun",
        "romantic",
      ])
      .default("friendly"),
  })
  .strict();
const offerIdParamsSchema = tokenParamsSchema.extend({
  offerId: z.coerce.number().int().positive(),
});
const eventIdParamsSchema = tokenParamsSchema.extend({
  eventId: z.coerce.number().int().positive(),
});
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must use YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Date is not a valid calendar date.");
const offerBodySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  })
  .strict()
  .superRefine((offer, context) => {
    const today = new Date().toISOString().slice(0, 10);
    if (offer.startDate > offer.endDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after the start date.",
      });
    }
    if (offer.endDate < today) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Expired offers cannot be published.",
      });
    }
  });
const eventPriceSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(
    /^(?:free|(?:£|\$|€)\d{1,6}(?:\.\d{2})?(?:\s+per\s+person)?|\d{1,6}(?:\.\d{2})?\s+(?:GBP|USD|EUR)(?:\s+per\s+person)?)$/i,
    "Price must be Free or a valid GBP, USD, or EUR amount.",
  );
const eventBodySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    date: calendarDateSchema,
    time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Time must use 24-hour HH:mm format."),
    price: eventPriceSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.date < new Date().toISOString().slice(0, 10)) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message: "Past events cannot be published.",
      });
    }
  });

const evidenceUrlSchema = z.string().trim().url().max(2_048);
const chefBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable(),
    bio: z.string().trim().max(2_000).nullable(),
    philosophy: z.string().trim().max(1_000).nullable(),
    awards: z.array(z.string().trim().min(1).max(240)).max(8),
    awardEvidenceUrls: z.array(evidenceUrlSchema).max(8),
    signatureDishes: z.array(z.string().trim().min(1).max(180)).max(12),
    dishEvidenceUrls: z.array(evidenceUrlSchema).max(12),
    removePhoto: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.awardEvidenceUrls.length > value.awards.length) {
      context.addIssue({ code: "custom", path: ["awardEvidenceUrls"], message: "Evidence cannot exceed awards." });
    }
    if (value.dishEvidenceUrls.length > value.signatureDishes.length) {
      context.addIssue({ code: "custom", path: ["dishEvidenceUrls"], message: "Evidence cannot exceed signature dishes." });
    }
  });
const chefUploadSchema = z.object({
  contentType: z.enum(CHEF_IMAGE_TYPES),
  sizeBytes: z.number().int().positive().max(CHEF_IMAGE_MAX_BYTES),
}).strict();
const chefFinalizeSchema = chefUploadSchema.extend({
  objectPath: z.string().regex(/^\/objects\/chef\/[0-9a-f-]{36}$/),
}).strict();

function setPortalPrivacyHeaders(res: {
  setHeader(name: string, value: string): unknown;
}) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
}

async function getVerifiedOwnerPlaceId(token: string): Promise<string | null> {
  const placeId = await validateToken(token);
  if (!placeId) return null;
  const [restaurant] = await db
    .select({ claimedAt: restaurantsTable.claimedAt })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  return restaurant?.claimedAt ? placeId : null;
}

function invalidPortalLink(res: {
  status(code: number): { json(value: unknown): unknown };
}) {
  res.status(404).json({ success: false, error: "Invalid or expired login link." });
}

function emptyChef() {
  return {
    name: null,
    bio: null,
    philosophy: null,
    awards: [],
    awardEvidenceUrls: [],
    signatureDishes: [],
    dishEvidenceUrls: [],
    photoObjectPath: null,
    photoMimeType: null,
    photoSizeBytes: null,
    moderationStatus: "pending",
    verifiedAt: null,
    rejectionReason: null,
  };
}

function publicChef(row: typeof restaurantChefProfilesTable.$inferSelect | undefined) {
  if (!row || row.moderationStatus !== "approved") return emptyChef();
  return {
    name: row.name,
    bio: row.bio,
    philosophy: row.philosophy,
    awards: row.awards,
    awardEvidenceUrls: row.awardEvidenceUrls,
    signatureDishes: row.signatureDishes,
    dishEvidenceUrls: row.dishEvidenceUrls,
    photoObjectPath: row.photoObjectPath,
    photoMimeType: row.photoMimeType,
    photoSizeBytes: row.photoSizeBytes,
    moderationStatus: row.moderationStatus,
    verifiedAt: row.verifiedAt,
    rejectionReason: null,
  };
}

router.get("/portal/:token/chef", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [chef] = await db
    .select()
    .from(restaurantChefProfilesTable)
    .where(eq(restaurantChefProfilesTable.restaurantId, placeId))
    .limit(1);
  res.json({ success: true, chef: chef ?? emptyChef() });
});

router.get("/portal/:token/chef/photo", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  if (!params.success) { invalidPortalLink(res); return; }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) { invalidPortalLink(res); return; }
  const [chef] = await db.select({ photoObjectPath: restaurantChefProfilesTable.photoObjectPath })
    .from(restaurantChefProfilesTable)
    .where(eq(restaurantChefProfilesTable.restaurantId, placeId)).limit(1);
  if (!chef?.photoObjectPath) { res.status(404).json({ error: "Object not found." }); return; }
  await streamChefObject(chef.photoObjectPath, res, "private, no-store");
});

router.put("/portal/:token/chef", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  const body = chefBodySchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({ success: false, error: body.error.issues[0]?.message ?? "Invalid chef profile." });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [existing] = await db
    .select({ photoObjectPath: restaurantChefProfilesTable.photoObjectPath, photoMimeType: restaurantChefProfilesTable.photoMimeType, photoSizeBytes: restaurantChefProfilesTable.photoSizeBytes })
    .from(restaurantChefProfilesTable)
    .where(eq(restaurantChefProfilesTable.restaurantId, placeId))
    .limit(1);
  const { removePhoto, ...chefData } = body.data;
  const values = {
    restaurantId: placeId,
    ...chefData,
    photoObjectPath: removePhoto ? null : existing?.photoObjectPath ?? null,
    photoMimeType: removePhoto ? null : existing?.photoMimeType ?? null,
    photoSizeBytes: removePhoto ? null : existing?.photoSizeBytes ?? null,
    moderationStatus: "pending",
    verifiedAt: null,
    reviewedBy: null,
    rejectionReason: null,
  } as const;
  const [chef] = existing
    ? await db.update(restaurantChefProfilesTable).set(values).where(eq(restaurantChefProfilesTable.restaurantId, placeId)).returning()
    : await db.insert(restaurantChefProfilesTable).values(values).returning();
  if (removePhoto && existing?.photoObjectPath) {
    try { await deleteChefObject(existing.photoObjectPath); } catch (error) {
      req.log.warn({ err: error }, "Chef photo cleanup failed");
    }
  }
  res.json({ success: true, chef });
});

router.delete("/portal/:token/chef", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [chef] = await db.select({ photoObjectPath: restaurantChefProfilesTable.photoObjectPath })
    .from(restaurantChefProfilesTable)
    .where(eq(restaurantChefProfilesTable.restaurantId, placeId)).limit(1);
  await db.delete(restaurantChefProfilesTable).where(eq(restaurantChefProfilesTable.restaurantId, placeId));
  if (chef?.photoObjectPath) {
    try { await deleteChefObject(chef.photoObjectPath); } catch (error) {
      req.log.warn({ err: error }, "Chef photo cleanup failed");
    }
  }
  res.json({ success: true });
});

router.post("/portal/:token/chef/photo/upload-intent", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  const body = chefUploadSchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({ success: false, error: "Only JPEG, PNG, and WebP images up to 5 MiB are accepted." });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  await db.delete(chefPhotoUploadIntentsTable).where(
    and(eq(chefPhotoUploadIntentsTable.restaurantId, placeId), lt(chefPhotoUploadIntentsTable.expiresAt, new Date())),
  );
  const active = await db.select({ id: chefPhotoUploadIntentsTable.id })
    .from(chefPhotoUploadIntentsTable)
    .where(and(eq(chefPhotoUploadIntentsTable.restaurantId, placeId), gt(chefPhotoUploadIntentsTable.expiresAt, new Date()), isNull(chefPhotoUploadIntentsTable.consumedAt)))
    .limit(3);
  if (active.length >= 3) {
    res.status(429).json({ success: false, error: "Too many active photo uploads." });
    return;
  }
  const objectPath = createChefObjectPath();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  let uploadUrl: string;
  try {
    uploadUrl = await createChefUploadUrl(objectPath, body.data.contentType, body.data.sizeBytes);
    await db.insert(chefPhotoUploadIntentsTable).values({
      objectPath, restaurantId: placeId, contentType: body.data.contentType,
      sizeBytes: body.data.sizeBytes, expiresAt,
    }).returning({ id: chefPhotoUploadIntentsTable.id });
  } catch (error) {
    req.log.warn({ err: error }, "Chef photo upload intent creation failed");
    res.status(503).json({ success: false, error: "Photo uploads are temporarily unavailable." });
    return;
  }
  res.status(201).json({
    success: true,
    objectPath,
    uploadUrl,
    uploadMethod: "PUT",
    uploadHeaders: { "Content-Type": body.data.contentType },
    expiresInSeconds: 900,
  });
});

router.post("/portal/:token/chef/photo/finalize", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  const body = chefFinalizeSchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({ success: false, error: "Invalid photo upload." });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [intent] = await db.update(chefPhotoUploadIntentsTable).set({ consumedAt: new Date() }).where(and(
    eq(chefPhotoUploadIntentsTable.restaurantId, placeId),
    eq(chefPhotoUploadIntentsTable.objectPath, body.data.objectPath),
    eq(chefPhotoUploadIntentsTable.contentType, body.data.contentType),
    eq(chefPhotoUploadIntentsTable.sizeBytes, body.data.sizeBytes),
    isNull(chefPhotoUploadIntentsTable.consumedAt),
    gt(chefPhotoUploadIntentsTable.expiresAt, new Date()),
  )).returning();
  if (!intent) {
    res.status(400).json({ success: false, error: "Invalid, expired, or already-used photo upload." });
    return;
  }
  try {
    await finalizeChefObject(body.data.objectPath, body.data.contentType, body.data.sizeBytes, placeId);
  } catch (error) {
    req.log.warn({ err: error }, "Chef photo finalization failed");
    res.status(400).json({ success: false, error: "The uploaded image could not be verified." });
    return;
  }
  const [existing] = await db.select().from(restaurantChefProfilesTable).where(eq(restaurantChefProfilesTable.restaurantId, placeId)).limit(1);
  const values = {
    restaurantId: placeId,
    name: existing?.name ?? null,
    bio: existing?.bio ?? null,
    philosophy: existing?.philosophy ?? null,
    awards: existing?.awards ?? [],
    awardEvidenceUrls: existing?.awardEvidenceUrls ?? [],
    signatureDishes: existing?.signatureDishes ?? [],
    dishEvidenceUrls: existing?.dishEvidenceUrls ?? [],
    photoObjectPath: body.data.objectPath,
    photoMimeType: body.data.contentType,
    photoSizeBytes: body.data.sizeBytes,
    moderationStatus: "pending",
    verifiedAt: null,
    reviewedBy: null,
    rejectionReason: null,
  } as const;
  const [chef] = existing
    ? await db.update(restaurantChefProfilesTable).set(values).where(eq(restaurantChefProfilesTable.restaurantId, placeId)).returning()
    : await db.insert(restaurantChefProfilesTable).values(values).returning();
  if (existing?.photoObjectPath && existing.photoObjectPath !== body.data.objectPath) {
    try { await deleteChefObject(existing.photoObjectPath); } catch (error) {
      req.log.warn({ err: error }, "Previous chef photo cleanup failed");
    }
  }
  res.json({ success: true, chef });
});

async function getVerifiedMarketingDetails(token: string) {
  const placeId = await validateToken(token);
  if (!placeId) return null;
  const [restaurant] = await db
    .select({
      name: restaurantsTable.name,
      city: restaurantsTable.city,
      cuisineTags: restaurantsTable.cuisineTags,
      types: restaurantsTable.types,
      rating: restaurantsTable.rating,
      claimStatus: restaurantsTable.claimStatus,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant?.claimStatus) return null;
  return {
    name: restaurant.name,
    city: restaurant.city,
    cuisine:
      restaurant.cuisineTags.find((value) => value.trim()) ??
      restaurant.types.find((value) => value.trim()) ??
      "Restaurant",
    rating: restaurant.rating,
  };
}

router.post(
  "/portal/:token/marketing/seo",
  seoLimiter,
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Referrer-Policy", "no-referrer");
    const params = tokenParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ success: false, error: "Invalid or expired login link." });
      return;
    }
    const details = await getVerifiedMarketingDetails(params.data.token);
    if (!details) {
      res.status(404).json({ success: false, error: "Invalid or expired login link." });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ success: false, error: "AI SEO generation is not configured." });
      return;
    }
    try {
      const seo = await generateSeoCopy(details, (error) => {
        req.log.warn({ err: error }, "AI SEO usage could not be stored");
      });
      res.json({ success: true, seo });
    } catch (error) {
      req.log.warn({ err: error }, "Owner SEO generation failed");
      res.status(502).json({
        success: false,
        error: "AI SEO generation is temporarily unavailable.",
      });
    }
  },
);

router.get("/portal/:token/offers", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const offers = await db
    .select({
      id: restaurantOffersTable.id,
      title: restaurantOffersTable.title,
      description: restaurantOffersTable.description,
      startDate: restaurantOffersTable.startDate,
      endDate: restaurantOffersTable.endDate,
    })
    .from(restaurantOffersTable)
    .where(
      and(
        eq(restaurantOffersTable.restaurantId, placeId),
        gte(restaurantOffersTable.endDate, today),
      ),
    )
    .orderBy(asc(restaurantOffersTable.startDate), asc(restaurantOffersTable.id));
  res.json({ success: true, offers });
});

router.post("/portal/:token/offers", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  const body = offerBodySchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({
      success: false,
      error: body.error.issues[0]?.message ?? "Invalid offer.",
    });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [offer] = await db
    .insert(restaurantOffersTable)
    .values({ restaurantId: placeId, ...body.data })
    .returning();
  res.status(201).json({ success: true, offer });
});

router.patch("/portal/:token/offers/:offerId", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = offerIdParamsSchema.safeParse(req.params);
  const body = offerBodySchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({
      success: false,
      error: body.error.issues[0]?.message ?? "Invalid offer.",
    });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [offer] = await db
    .update(restaurantOffersTable)
    .set(body.data)
    .where(
      and(
        eq(restaurantOffersTable.id, params.data.offerId),
        eq(restaurantOffersTable.restaurantId, placeId),
      ),
    )
    .returning();
  if (!offer) {
    res.status(404).json({ success: false, error: "Offer not found." });
    return;
  }
  res.json({ success: true, offer });
});

router.delete("/portal/:token/offers/:offerId", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = offerIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [offer] = await db
    .delete(restaurantOffersTable)
    .where(
      and(
        eq(restaurantOffersTable.id, params.data.offerId),
        eq(restaurantOffersTable.restaurantId, placeId),
      ),
    )
    .returning({ id: restaurantOffersTable.id });
  if (!offer) {
    res.status(404).json({ success: false, error: "Offer not found." });
    return;
  }
  res.json({ success: true });
});

router.get("/portal/:token/events", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const events = await db
    .select({
      id: restaurantEventsTable.id,
      title: restaurantEventsTable.title,
      description: restaurantEventsTable.description,
      date: restaurantEventsTable.eventDate,
      time: restaurantEventsTable.eventTime,
      price: restaurantEventsTable.price,
    })
    .from(restaurantEventsTable)
    .where(
      and(
        eq(restaurantEventsTable.restaurantId, placeId),
        gte(restaurantEventsTable.eventDate, new Date().toISOString().slice(0, 10)),
      ),
    )
    .orderBy(
      asc(restaurantEventsTable.eventDate),
      asc(restaurantEventsTable.eventTime),
      asc(restaurantEventsTable.id),
    );
  res.json({ success: true, events });
});

router.post("/portal/:token/events", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = tokenParamsSchema.safeParse(req.params);
  const body = eventBodySchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({
      success: false,
      error: body.error.issues[0]?.message ?? "Invalid event.",
    });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const { date, time, ...details } = body.data;
  const [event] = await db
    .insert(restaurantEventsTable)
    .values({
      restaurantId: placeId,
      eventDate: date,
      eventTime: time,
      ...details,
    })
    .returning();
  res.status(201).json({
    success: true,
    event: { ...event, date: event.eventDate, time: event.eventTime },
  });
});

router.patch("/portal/:token/events/:eventId", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = eventIdParamsSchema.safeParse(req.params);
  const body = eventBodySchema.safeParse(req.body);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  if (!body.success) {
    res.status(400).json({
      success: false,
      error: body.error.issues[0]?.message ?? "Invalid event.",
    });
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const { date, time, ...details } = body.data;
  const [event] = await db
    .update(restaurantEventsTable)
    .set({ eventDate: date, eventTime: time, ...details })
    .where(
      and(
        eq(restaurantEventsTable.id, params.data.eventId),
        eq(restaurantEventsTable.restaurantId, placeId),
      ),
    )
    .returning();
  if (!event) {
    res.status(404).json({ success: false, error: "Event not found." });
    return;
  }
  res.json({
    success: true,
    event: { ...event, date: event.eventDate, time: event.eventTime },
  });
});

router.delete("/portal/:token/events/:eventId", async (req, res): Promise<void> => {
  setPortalPrivacyHeaders(res);
  const params = eventIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    invalidPortalLink(res);
    return;
  }
  const placeId = await getVerifiedOwnerPlaceId(params.data.token);
  if (!placeId) {
    invalidPortalLink(res);
    return;
  }
  const [event] = await db
    .delete(restaurantEventsTable)
    .where(
      and(
        eq(restaurantEventsTable.id, params.data.eventId),
        eq(restaurantEventsTable.restaurantId, placeId),
      ),
    )
    .returning({ id: restaurantEventsTable.id });
  if (!event) {
    res.status(404).json({ success: false, error: "Event not found." });
    return;
  }
  res.json({ success: true });
});

router.post(
  "/portal/:token/marketing/social",
  socialLimiter,
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Referrer-Policy", "no-referrer");
    const params = tokenParamsSchema.safeParse(req.params);
    const body = socialMarketingSchema.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ success: false, error: "Invalid or expired login link." });
      return;
    }
    if (!body.success) {
      res.status(400).json({ success: false, error: "Invalid social post tone." });
      return;
    }
    const details = await getVerifiedMarketingDetails(params.data.token);
    if (!details) {
      res.status(404).json({ success: false, error: "Invalid or expired login link." });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({
        success: false,
        error: "AI social post generation is not configured.",
      });
      return;
    }
    try {
      const posts = await generateSocialCopy(
        { ...details, tone: body.data.tone },
        (error) => {
          req.log.warn({ err: error }, "AI social usage could not be stored");
        },
      );
      res.json({ success: true, posts });
    } catch (error) {
      req.log.warn({ err: error }, "Owner social generation failed");
      res.status(502).json({
        success: false,
        error: "AI social generation is temporarily unavailable.",
      });
    }
  },
);

router.get("/portal/:token", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  const params = tokenParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const placeId = await validateToken(params.data.token);
  if (!placeId) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const [restaurant] = await db
    .select({
      placeId: restaurantsTable.placeId,
      name: restaurantsTable.name,
      description: restaurantsTable.websiteDescription,
      address: restaurantsTable.address,
      website: restaurantsTable.website,
      onboardingStatus: restaurantsTable.onboardingStatus,
      claimStatus: restaurantsTable.claimStatus,
      verified: restaurantsTable.claimedAt,
      premium: restaurantsTable.premium,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  try {
    await Promise.all([
      logEvent(restaurant.placeId, "portal_login"),
      recordOwnerLogin(restaurant.placeId),
    ]);
  } catch (error) {
    req.log.warn({ err: error }, "Portal login state could not be recorded");
  }
  res.json({
    success: true,
    restaurant: {
      ...restaurant,
      verified: restaurant.verified !== null,
      marketingEligible: restaurant.claimStatus !== null,
    },
  });
});

router.post("/portal/:token/analytics-insight", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  const params = z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const placeId = await validateToken(params.data.token);
  if (!placeId) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const [restaurant] = await db
    .select({ premium: restaurantsTable.premium })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  try {
    const analytics = await getRestaurantAnalytics(placeId);
    const insight = await generateOwnerAnalyticsInsight(
      placeId,
      analytics,
      restaurant.premium,
    );
    res.json({ success: true, analytics, insight });
  } catch (error) {
    req.log.error({ err: error }, "Owner analytics insight failed");
    res.status(503).json({
      success: false,
      error: "Your analytics insight is temporarily unavailable.",
    });
  }
});

router.get("/portal/:token/analytics", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  const params = z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  const placeId = await validateToken(params.data.token);
  if (!placeId) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  try {
    const analytics = await getRestaurantAnalytics(placeId);
    res.json({ success: true, analytics });
  } catch (error) {
    req.log.error({ err: error }, "Owner analytics failed");
    res.status(503).json({
      success: false,
      error: "Restaurant analytics are temporarily unavailable.",
    });
  }
});

export default router;