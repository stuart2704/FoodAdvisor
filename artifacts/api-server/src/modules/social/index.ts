import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db, restaurantsTable, socialAccountsTable, socialLogsTable, socialPostsTable, socialSchedulesTable, socialSettingsTable } from "@workspace/db";
import { adminOnly } from "../../middleware/adminOnly";
import { encryptToken } from "./crypto";
import { facebookAdapter } from "./adapters/facebook.adapter";
import { generateRestaurantPost, generateBrandPost } from "./ai.service";
import { publishPost } from "./services/publishing.service";
import { getSocialSettings, SOCIAL_SETTINGS_ID } from "./settings";
import { instagramRouter } from "./instagram.routes";
import { facebookRouter } from "./facebook.routes";

const router: IRouter = Router();
const verifiedRunner = () => process.env.SOCIAL_AUTOMATION_ENABLED === "true"
  && process.env.SOCIAL_EXTERNAL_SCHEDULER_VERIFIED === "true";
router.use(adminOnly);
router.use("/social/instagram", instagramRouter);
router.use("/social/facebook", facebookRouter);
const publicAccount = (a: any) => ({ id: a.id, restaurantId: a.restaurantId, platform: a.platform, displayName: a.displayName, createdAt: a.createdAt, status: a.status === "connected" && a.tokenExpiresAt && a.tokenExpiresAt <= new Date() ? "expired" : a.status, tokenExpiresAt: a.tokenExpiresAt });
const validPlatform = (p: unknown) => p === "facebook";
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;
function dailyTime(value: unknown): boolean { return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
async function restaurant(id: string) {
  const [r] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.placeId, id));
  return r;
}

router.post("/social/accounts/connect", async (req, res): Promise<void> => {
  const { restaurantId = null, platform, accessToken } = req.body ?? {};
  if ((restaurantId !== null && typeof restaurantId !== "string") || !validPlatform(platform) || typeof accessToken !== "string" || !accessToken) { res.status(400).json({ error: "platform facebook and accessToken are required." }); return; }
  if (restaurantId !== null && !(await restaurant(restaurantId))) { res.status(404).json({ error: "Restaurant not found." }); return; }
  try {
    const connection = await facebookAdapter.validateConnection(accessToken);
    const encrypted = encryptToken(accessToken);
    const [account] = await db.insert(socialAccountsTable).values({ id: randomUUID(), restaurantId, platform, pageId: connection.id, displayName: connection.name, accessToken: encrypted.encrypted, accessTokenIv: encrypted.iv, accessTokenTag: encrypted.tag, status: "connected" }).returning();
    res.status(201).json({ account: publicAccount(account) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Facebook connection failed." }); }
});
router.get("/social/accounts", async (_req, res): Promise<void> => {
  const accounts = await db.select().from(socialAccountsTable).orderBy(desc(socialAccountsTable.createdAt));
  res.json({ accounts: accounts.map(publicAccount) });
});
router.post("/social/accounts/disconnect", async (req, res): Promise<void> => {
  const { accountId } = req.body ?? {};
  if (typeof accountId !== "string" || !isUuid(accountId)) {
    res.status(400).json({ error: "A valid accountId is required." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      // Removing the row also removes its encrypted publishing credential.
      const [removed] = await tx.delete(socialAccountsTable)
        .where(eq(socialAccountsTable.id, accountId))
        .returning({
          id: socialAccountsTable.id,
          platform: socialAccountsTable.platform,
          restaurantId: socialAccountsTable.restaurantId,
        });
      if (!removed) return null;
      const accountScope = removed.restaurantId === null
        ? isNull(socialAccountsTable.restaurantId)
        : eq(socialAccountsTable.restaurantId, removed.restaurantId);
      const [remaining] = await tx.select({ id: socialAccountsTable.id }).from(socialAccountsTable)
        .where(and(accountScope, eq(socialAccountsTable.platform, removed.platform), eq(socialAccountsTable.status, "connected")))
        .limit(1);
      if (remaining) return { pausedSchedules: 0, returnedToDrafts: 0 };

      const scheduleScope = removed.restaurantId === null
        ? isNull(socialSchedulesTable.restaurantId)
        : eq(socialSchedulesTable.restaurantId, removed.restaurantId);
      const pausedSchedules = await tx.update(socialSchedulesTable)
        .set({ enabled: false, updatedAt: new Date() })
        .where(and(scheduleScope, eq(socialSchedulesTable.platform, removed.platform), eq(socialSchedulesTable.enabled, true)))
        .returning({ id: socialSchedulesTable.id });
      const postScope = removed.restaurantId === null
        ? isNull(socialPostsTable.restaurantId)
        : eq(socialPostsTable.restaurantId, removed.restaurantId);
      const returnedToDrafts = await tx.update(socialPostsTable)
        .set({ status: "draft", scheduledFor: null, errorMessage: null, updatedAt: new Date() })
        .where(and(postScope, eq(socialPostsTable.platform, removed.platform), eq(socialPostsTable.status, "scheduled")))
        .returning({ id: socialPostsTable.id });
      return { pausedSchedules: pausedSchedules.length, returnedToDrafts: returnedToDrafts.length };
    });
    if (!result) {
      res.status(404).json({ error: "Connected account not found." });
      return;
    }
    res.json({ success: true, ...result });
  } catch {
    res.status(500).json({ error: "Could not disconnect the account." });
  }
});
router.post("/social/schedules", async (req, res): Promise<void> => {
  const { id, restaurantId = null, platform, frequency, timeOfDay, enabled = true } = req.body ?? {};
  if ((restaurantId !== null && typeof restaurantId !== "string") || !validPlatform(platform) || frequency !== "daily" || !dailyTime(timeOfDay) || typeof enabled !== "boolean" || (id !== undefined && (typeof id !== "string" || !isUuid(id)))) { res.status(400).json({ error: "A valid ID, Facebook platform, daily frequency, and UTC timeOfDay HH:mm are required." }); return; }
  if (restaurantId !== null && !(await restaurant(restaurantId))) { res.status(404).json({ error: "Restaurant not found." }); return; }
  if (typeof id === "string") {
    const [updated] = await db.update(socialSchedulesTable).set({ restaurantId, platform, frequency, timeOfDay, enabled, updatedAt: new Date() }).where(eq(socialSchedulesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Schedule not found." }); return; }
    res.json({ schedule: updated }); return;
  }
  const scope = restaurantId === null ? isNull(socialSchedulesTable.restaurantId) : eq(socialSchedulesTable.restaurantId, restaurantId);
  const existing = await db.select().from(socialSchedulesTable).where(and(scope, eq(socialSchedulesTable.platform, platform), eq(socialSchedulesTable.frequency, frequency), eq(socialSchedulesTable.timeOfDay, timeOfDay)));
  if (existing[0]) {
    const [updated] = await db.update(socialSchedulesTable)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(socialSchedulesTable.id, existing[0].id)).returning();
    res.json({ schedule: updated }); return;
  }
  const [schedule] = await db.insert(socialSchedulesTable).values({ id: randomUUID(), restaurantId, platform, frequency, timeOfDay, enabled }).returning();
  res.status(201).json({ schedule });
});
router.get("/social/schedules", async (_req, res): Promise<void> => { res.json({ schedules: await db.select().from(socialSchedulesTable).orderBy(desc(socialSchedulesTable.createdAt)) }); });
router.post("/social/posts/generate", async (req, res): Promise<void> => {
  const { restaurantId, platform, scope = "restaurant" } = req.body ?? {};
  if (!validPlatform(platform) || (scope !== "brand" && typeof restaurantId !== "string")) { res.status(400).json({ error: "restaurantId and platform facebook are required." }); return; }
  const r = typeof restaurantId === "string" ? await restaurant(restaurantId) : undefined;
  if (scope !== "brand" && !r) { res.status(404).json({ error: "Restaurant not found." }); return; }
  try {
    const generated = scope === "brand" ? await generateBrandPost() : await generateRestaurantPost({ placeId: r!.placeId, name: r!.name, city: r!.city, cuisine: r!.cuisines?.join(", ") ?? r!.cuisineTags?.join(", "), rating: r!.rating });
    const [post] = await db.insert(socialPostsTable).values({ id: randomUUID(), restaurantId: scope === "brand" ? null : restaurantId, platform, content: generated.caption, mediaUrl: generated.media, status: "draft", idempotencyKey: randomUUID() }).returning();
    res.status(201).json({ post });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Post generation failed." }); }
});
router.post("/social/posts/schedule", async (req, res): Promise<void> => {
  const { postId, time } = req.body ?? {};
  if (typeof postId !== "string" || !isUuid(postId)
    || typeof time !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(time)) {
    res.status(400).json({ error: "A valid postId and ISO date-time with a timezone are required." });
    return;
  }
  const scheduledFor = new Date(time);
  if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor <= new Date()) {
    res.status(400).json({ error: "Choose a valid future publishing time." });
    return;
  }
  const [candidate] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, postId)).limit(1);
  if (!candidate) { res.status(404).json({ error: "Post not found." }); return; }
  if (candidate.status !== "draft" || !validPlatform(candidate.platform)) {
    res.status(409).json({ error: "Only Facebook drafts can be scheduled." });
    return;
  }
  const scope = candidate.restaurantId === null
    ? isNull(socialAccountsTable.restaurantId)
    : eq(socialAccountsTable.restaurantId, candidate.restaurantId);
  await getSocialSettings();
  const result = await db.transaction(async (tx) => {
    const [settings] = await tx.select({ automation: socialSettingsTable.automation })
      .from(socialSettingsTable).where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID))
      .limit(1).for("update");
    if (!settings?.automation) return { reason: "automation-off" as const };
    const [account] = await tx.select({ id: socialAccountsTable.id }).from(socialAccountsTable)
      .where(and(scope, eq(socialAccountsTable.platform, candidate.platform), eq(socialAccountsTable.status, "connected")))
      .limit(1).for("update");
    if (!account) return { reason: "no-account" as const };
    if (candidate.restaurantId === null) {
      const [brandSchedule] = await tx.select({ id: socialSchedulesTable.id }).from(socialSchedulesTable)
        .where(and(isNull(socialSchedulesTable.restaurantId), eq(socialSchedulesTable.platform, candidate.platform), eq(socialSchedulesTable.enabled, true)))
        .limit(1).for("update");
      if (!brandSchedule) return { reason: "no-brand-schedule" as const };
    }
    const [post] = await tx.update(socialPostsTable)
      .set({ status: "scheduled", scheduledFor, updatedAt: new Date() })
      .where(and(eq(socialPostsTable.id, postId), eq(socialPostsTable.status, "draft")))
      .returning();
    return post ? { reason: "scheduled" as const, post } : { reason: "not-draft" as const };
  });
  if (result.reason === "automation-off") {
    res.status(409).json({ error: "Turn on master automation before scheduling a post. You can still publish a draft manually." });
    return;
  }
  if (result.reason === "no-account") {
    res.status(409).json({ error: "Connect a Facebook Page for this post before scheduling it." });
    return;
  }
  if (result.reason === "no-brand-schedule") {
    res.status(409).json({ error: "Enable a brand schedule before scheduling a brand post." });
    return;
  }
  if (result.reason === "not-draft") { res.status(409).json({ error: "Post is no longer a draft." }); return; }
  res.json({ success: true, post: result.post });
});
router.post("/social/posts/publish", async (req, res): Promise<void> => {
  const { postId } = req.body ?? {};
  if (typeof postId !== "string" || !isUuid(postId)) { res.status(400).json({ error: "A valid postId is required." }); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, postId));
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  if (post.status === "published") { res.json({ post }); return; }
  try {
    const updated = await publishPost(postId);
    if (!updated) { res.status(409).json({ error: "Post is already claimed or is not ready to publish." }); return; }
    res.json({ post: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "No connected social account for this post.") {
      res.status(409).json({ error: error.message }); return;
    }
    res.status(502).json({ error: "Social provider rejected the post." });
  }
});
router.get("/social/posts", async (_req, res): Promise<void> => { res.json({ posts: await db.select().from(socialPostsTable).orderBy(desc(socialPostsTable.createdAt)) }); });
router.get("/social/logs", async (_req, res): Promise<void> => { res.json({ logs: await db.select().from(socialLogsTable).orderBy(desc(socialLogsTable.createdAt)) }); });
router.get("/social/errors", async (_req, res): Promise<void> => {
  const [total] = await db.select({ count: count() }).from(socialLogsTable)
    .where(eq(socialLogsTable.status, "failed"));
  const errors = await db.select().from(socialLogsTable)
    .where(eq(socialLogsTable.status, "failed"))
    .orderBy(desc(socialLogsTable.createdAt)).limit(100);
  // Existing logs store a safe generic message, not provider error codes.
  // Do not guess token, permission, or rate-limit causes from that message.
  res.json({
    summary: {
      token_error: 0, permission_error: 0, rate_limit: 0,
      upload_error: 0, publish_error: 0, status_error: 0,
      unclassified: total?.count ?? 0,
    },
    lastError: errors[0] ?? null,
    errors,
  });
});
router.get("/social/settings", async (_req, res): Promise<void> => {
  const masterSettings = await getSocialSettings();
  const [brand] = await db.select({ id: socialSchedulesTable.id }).from(socialSchedulesTable)
    .where(and(isNull(socialSchedulesTable.restaurantId), eq(socialSchedulesTable.enabled, true))).limit(1);
  const [restaurant] = await db.select({ id: socialSchedulesTable.id }).from(socialSchedulesTable)
    .where(and(isNotNull(socialSchedulesTable.restaurantId), eq(socialSchedulesTable.enabled, true))).limit(1);
  res.json({
    settings: {
      automation: masterSettings.automation,
      workerConfigured: verifiedRunner(),
      brandSchedulesEnabled: Boolean(brand),
      restaurantSchedulesEnabled: Boolean(restaurant),
      retryAttempts: 0,
      postingWindow: null,
    },
  });
});
router.post("/social/settings", async (req, res): Promise<void> => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1
    || !(typeof body.automation === "boolean" || typeof body.brandAutomation === "boolean")) {
    res.status(400).json({ error: "Send either automation or brandAutomation as a boolean." });
    return;
  }
  if (typeof body.automation === "boolean") {
    const enable = body.automation as boolean;
    if (enable && !verifiedRunner()) {
      res.status(409).json({ error: "Verify the external scheduled job in this environment and enable the server runner before turning on master automation." });
      return;
    }
    try {
      await getSocialSettings();
      const result = await db.transaction(async (tx) => {
        const [settings] = await tx.update(socialSettingsTable)
          .set({ automation: enable, updatedAt: new Date() })
          .where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID))
          .returning({ automation: socialSettingsTable.automation });
        if (!settings) throw new Error("Social automation settings were not initialized.");
        const posts = await tx.update(socialPostsTable)
          .set({ status: "draft", scheduledFor: null, errorMessage: null, updatedAt: new Date() })
          .where(enable
            ? and(eq(socialPostsTable.status, "scheduled"), lte(socialPostsTable.scheduledFor, new Date()))
            : eq(socialPostsTable.status, "scheduled"))
          .returning({ id: socialPostsTable.id });
        return { returnedToDrafts: posts.length };
      });
      res.json({
        success: true, automation: enable, ...result,
        workerConfigured: verifiedRunner(),
      });
    } catch {
      res.status(500).json({ error: "Could not update master automation." });
    }
    return;
  }
  const enable = body.brandAutomation as boolean;
  try {
    const result = await db.transaction(async (tx) => {
      if (enable) {
        const [account] = await tx.select({ id: socialAccountsTable.id }).from(socialAccountsTable)
          .where(and(isNull(socialAccountsTable.restaurantId), eq(socialAccountsTable.platform, "facebook"), eq(socialAccountsTable.status, "connected")))
          .limit(1).for("update");
        if (!account) return { error: "Connect a brand Facebook Page before enabling brand automation." };
      }
      const schedules = await tx.update(socialSchedulesTable)
        .set({ enabled: enable, updatedAt: new Date() })
        .where(and(isNull(socialSchedulesTable.restaurantId), eq(socialSchedulesTable.platform, "facebook")))
        .returning({ id: socialSchedulesTable.id });
      if (enable && schedules.length === 0) return { error: "Create a brand schedule before enabling brand automation." };
      const posts = enable ? [] : await tx.update(socialPostsTable)
        .set({ status: "draft", scheduledFor: null, errorMessage: null, updatedAt: new Date() })
        .where(and(isNull(socialPostsTable.restaurantId), eq(socialPostsTable.platform, "facebook"), eq(socialPostsTable.status, "scheduled")))
        .returning({ id: socialPostsTable.id });
      return { updatedSchedules: schedules.length, returnedToDrafts: posts.length };
    });
    if ("error" in result) { res.status(409).json({ error: result.error }); return; }
    res.json({
      success: true, brandAutomation: enable, ...result,
      workerConfigured: verifiedRunner(),
    });
  } catch {
    res.status(500).json({ error: "Could not update brand automation." });
  }
});
export default router;