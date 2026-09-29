import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, restaurantsTable, socialAccountsTable, socialLogsTable, socialPostsTable, socialSchedulesTable, socialSettingsTable } from "@workspace/db";
import { adminOnly } from "../../middleware/adminOnly";
import { encryptToken } from "./crypto";
import { facebookAdapter } from "./adapters/facebook.adapter";
import { generateRestaurantPost, generateBrandPost } from "./ai.service";
import { publishPost } from "./services/publishing.service";
import { getSocialSettings, SOCIAL_SETTINGS_ID } from "./settings";
import { instagramRouter } from "./instagram.routes";
import { approvedPhotoPath, photoUrl, validatePhotoObject } from "./media";
import { facebookRouter } from "./facebook.routes";
import { tiktokRouter } from "./tiktok.routes";
import { tiktokAdapter } from "./adapters/tiktok.adapter";
import { decryptToken } from "./crypto";
import { reviewedTikTokAccount, pendingTikTokAccount } from "./tiktok-account";

const router: IRouter = Router();
const verifiedRunner = () => process.env.SOCIAL_AUTOMATION_ENABLED === "true"
  && process.env.SOCIAL_EXTERNAL_SCHEDULER_VERIFIED === "true";
router.use(adminOnly);
router.use("/social/instagram", instagramRouter);
router.use("/social/facebook", facebookRouter);
router.use("/social/tiktok", tiktokRouter);
const publicAccount = (a: any) => ({ id: a.id, restaurantId: a.restaurantId, platform: a.platform, displayName: a.displayName, createdAt: a.createdAt, status: a.status === "connected" && a.tokenExpiresAt && a.tokenExpiresAt <= new Date() ? "expired" : a.status, tokenExpiresAt: a.tokenExpiresAt });
const validPlatform = (p: unknown) => p === "facebook" || p === "instagram" || p === "tiktok";
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;
function dailyTime(value: unknown): boolean { return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
async function restaurant(id: string) {
  const [r] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.placeId, id));
  return r;
}

router.post("/social/accounts/connect", async (req, res): Promise<void> => {
  const { restaurantId = null, platform, accessToken } = req.body ?? {};
  if ((restaurantId !== null && typeof restaurantId !== "string") || platform !== "facebook" || typeof accessToken !== "string" || !accessToken) { res.status(400).json({ error: "A Facebook Page accessToken is required." }); return; }
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
router.get("/social/posts/:postId/tiktok-options", async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.postId);
  if (!id.success) { res.status(400).json({ error: "Invalid post ID." }); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id.data)).limit(1);
  if (!post || post.platform !== "tiktok" || post.status !== "draft") {
    res.status(409).json({ error: "Only TikTok drafts can select privacy." }); return;
  }
  const scope = post.restaurantId === null ? isNull(socialAccountsTable.restaurantId) : eq(socialAccountsTable.restaurantId, post.restaurantId);
  const accounts = await db.select().from(socialAccountsTable)
    .where(and(scope, eq(socialAccountsTable.platform, "tiktok"), eq(socialAccountsTable.status, "connected"))).limit(2);
  const account = reviewedTikTokAccount(accounts);
  if (!account) { res.status(409).json({ error: accounts.length ? "Disconnect extra TikTok accounts before approving privacy." : "Connect a TikTok account first." }); return; }
  try {
    const creator = await tiktokAdapter.creatorInfo(decryptToken(account.accessToken, account.accessTokenIv, account.accessTokenTag));
    res.json({ accountId: account.id, displayName: creator.creator_nickname, privacyOptions: creator.privacy_level_options });
  } catch { res.status(502).json({ error: "Could not read TikTok creator settings. Reconnect if the token expired." }); }
});
router.post("/social/posts/:postId/tiktok-privacy", async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.postId);
  const privacy = z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]).safeParse(req.body?.privacyLevel);
  const selectedAccountId = z.string().uuid().safeParse(req.body?.accountId);
  if (!id.success || !privacy.success || !selectedAccountId.success) { res.status(400).json({ error: "A valid TikTok post, creator account, and privacy level are required." }); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id.data)).limit(1);
  if (!post || post.platform !== "tiktok" || post.status !== "draft") { res.status(409).json({ error: "Only TikTok drafts can change privacy." }); return; }
  const scope = post.restaurantId === null ? isNull(socialAccountsTable.restaurantId) : eq(socialAccountsTable.restaurantId, post.restaurantId);
  const accounts = await db.select().from(socialAccountsTable)
    .where(and(scope, eq(socialAccountsTable.platform, "tiktok"), eq(socialAccountsTable.status, "connected"))).limit(2);
  const account = reviewedTikTokAccount(accounts, selectedAccountId.data);
  if (!account) {
    res.status(409).json({ error: "TikTok account changed. Review the creator and privacy options again." }); return;
  }
  try {
    const creator = await tiktokAdapter.creatorInfo(decryptToken(account.accessToken, account.accessTokenIv, account.accessTokenTag));
    if (!creator.privacy_level_options.includes(privacy.data)) { res.status(409).json({ error: "This privacy setting is not available for this account." }); return; }
    const [updated] = await db.update(socialPostsTable).set({ accountId: account.id, privacyLevel: privacy.data, updatedAt: new Date() })
      .where(and(eq(socialPostsTable.id, post.id), eq(socialPostsTable.status, "draft"))).returning();
    if (!updated) { res.status(409).json({ error: "Post changed. Refresh and try again." }); return; }
    res.json({ post: updated });
  } catch { res.status(502).json({ error: "Could not confirm TikTok privacy settings." }); }
});
router.post("/social/accounts/disconnect", async (req, res): Promise<void> => {
  const { accountId } = req.body ?? {};
  if (typeof accountId !== "string" || !isUuid(accountId)) {
    res.status(400).json({ error: "A valid accountId is required." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [pending] = await tx.select({ id: socialPostsTable.id }).from(socialPostsTable)
        .where(and(eq(socialPostsTable.accountId, accountId), eq(socialPostsTable.status, "publishing")))
        .limit(1);
      if (pending) return { pending: true as const };
      // Removing the row also removes its encrypted publishing credential.
      const [removed] = await tx.delete(socialAccountsTable)
        .where(eq(socialAccountsTable.id, accountId))
        .returning({
          id: socialAccountsTable.id,
          platform: socialAccountsTable.platform,
          restaurantId: socialAccountsTable.restaurantId,
        });
      if (!removed) return null;
      if (removed.platform === "tiktok") {
        await tx.update(socialPostsTable)
          .set({ accountId: null, privacyLevel: null, status: "draft", scheduledFor: null, updatedAt: new Date() })
          .where(and(eq(socialPostsTable.accountId, accountId), inArray(socialPostsTable.status, ["draft", "scheduled"])));
      }
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
    if ("pending" in result) {
      res.status(409).json({ error: "Check pending TikTok post status before disconnecting this account." }); return;
    }
    res.json({ success: true, ...result });
  } catch {
    res.status(500).json({ error: "Could not disconnect the account." });
  }
});
router.post("/social/schedules", async (req, res): Promise<void> => {
  const { id, restaurantId = null, platform, frequency, timeOfDay, enabled = true } = req.body ?? {};
  if ((restaurantId !== null && typeof restaurantId !== "string") || !validPlatform(platform) || frequency !== "daily" || !dailyTime(timeOfDay) || typeof enabled !== "boolean" || (id !== undefined && (typeof id !== "string" || !isUuid(id)))) { res.status(400).json({ error: "A valid ID, platform, daily frequency, and UTC timeOfDay HH:mm are required." }); return; }
  if (restaurantId === null && platform !== "facebook") { res.status(409).json({ error: "Instagram and TikTok schedules require a restaurant with approved photo media." }); return; }
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
router.post("/social/posts/draft", async (req, res): Promise<void> => {
  const body = z.object({
    accountId: z.string().uuid(),
    content: z.string().min(1).max(5000).refine(value => value.trim().length > 0),
  }).strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose a Facebook brand Page and enter post text (up to 5,000 characters)." }); return; }
  const [account] = await db.select({ id: socialAccountsTable.id }).from(socialAccountsTable)
    .where(and(eq(socialAccountsTable.id, body.data.accountId), isNull(socialAccountsTable.restaurantId),
      eq(socialAccountsTable.platform, "facebook"), eq(socialAccountsTable.status, "connected"))).limit(1);
  if (!account) { res.status(409).json({ error: "That Facebook brand Page is not connected. Refresh the accounts list." }); return; }
  const [post] = await db.insert(socialPostsTable).values({
    id: randomUUID(), restaurantId: null, platform: "facebook", accountId: account.id,
    content: body.data.content, status: "draft", idempotencyKey: randomUUID(),
  }).returning();
  res.status(201).json({ post });
});
router.post("/social/posts/generate", async (req, res): Promise<void> => {
  const { restaurantId, platform, scope = "restaurant" } = req.body ?? {};
  if (!validPlatform(platform) || !["brand", "restaurant"].includes(scope) || (scope !== "brand" && typeof restaurantId !== "string")) { res.status(400).json({ error: "restaurantId and a supported platform are required." }); return; }
  if (scope === "brand" && platform !== "facebook") {
    res.status(409).json({ error: `${platform} requires approved photo media; brand text-only drafts are not supported.` }); return;
  }
  const r = typeof restaurantId === "string" ? await restaurant(restaurantId) : undefined;
  if (scope !== "brand" && (!r || !r.published)) { res.status(404).json({ error: "Published restaurant not found." }); return; }
  const started = Date.now();
  try {
    const [previous] = await db.select({ total: count() }).from(socialPostsTable)
      .where(scope === "brand" ? isNull(socialPostsTable.restaurantId) : eq(socialPostsTable.restaurantId, restaurantId));
    // Cuisine tags are not independently approved for social copy.
    const generated = scope === "brand" ? await generateBrandPost() : await generateRestaurantPost({ placeId: r!.placeId, name: r!.name, city: r!.city }, previous?.total ?? 0);
    const post = await db.transaction(async (tx) => {
      const [created] = await tx.insert(socialPostsTable).values({ id: randomUUID(), restaurantId: scope === "brand" ? null : restaurantId, platform, content: generated.caption, mediaObjectPath: generated.mediaObjectPath, status: "draft", idempotencyKey: randomUUID() }).returning();
      await tx.insert(socialLogsTable).values({ id: randomUUID(), postId: created.id, restaurantId: created.restaurantId, platform, event: "generate", status: "success", durationMs: Date.now() - started });
      return created;
    });
    res.status(201).json({ post });
  } catch (error) {
    await db.insert(socialLogsTable).values({ id: randomUUID(), restaurantId: scope === "brand" ? null : restaurantId, platform, event: "generate", status: "failed", message: "Manual draft generation failed.", durationMs: Date.now() - started });
    res.status(502).json({ error: error instanceof Error ? error.message : "Post generation failed." });
  }
});
router.post("/social/posts/:postId/photo-approval", async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.postId);
  const body = z.object({ approved: z.boolean() }).strict().safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: "A valid post ID and approved boolean are required." }); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id.data)).limit(1);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  if (body.data.approved && post.status !== "draft") { res.status(409).json({ error: "Only draft photos can be approved." }); return; }
  if (post.status === "publishing") { res.status(409).json({ error: "Cannot change photo approval while a post is publishing." }); return; }
  try {
    let url: string | null = null;
    if (body.data.approved) {
      // Check current moderation and bytes before exposing a public endpoint.
      const path = await approvedPhotoPath({ ...post, mediaApprovedAt: new Date() });
      if (!path) { res.status(409).json({ error: "An approved, unchanged chef photo is required." }); return; }
      await validatePhotoObject(path);
      url = await photoUrl(post.id);
    }
    const [updated] = await db.update(socialPostsTable).set({
      mediaApprovedAt: body.data.approved ? new Date() : null,
      mediaUrl: url,
      updatedAt: new Date(),
    }).where(and(eq(socialPostsTable.id, post.id),
      body.data.approved ? eq(socialPostsTable.status, "draft") : ne(socialPostsTable.status, "publishing"),
    )).returning();
    if (!updated) { res.status(409).json({ error: "Post status changed. Refresh and try again." }); return; }
    res.json({ post: updated });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Photo approval failed." }); }
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
    res.status(409).json({ error: "Only supported platform drafts can be scheduled." });
    return;
  }
  if (candidate.platform !== "facebook" && (!candidate.mediaApprovedAt || !await approvedPhotoPath(candidate) || !candidate.mediaUrl)) {
    res.status(409).json({ error: `${candidate.platform} requires an approved chef photo before scheduling.` }); return;
  }
  if (candidate.platform === "tiktok" && (!candidate.privacyLevel || !candidate.accountId)) {
    res.status(409).json({ error: "Review the TikTok account and privacy setting before scheduling." }); return;
  }
  const scope = candidate.restaurantId === null
    ? isNull(socialAccountsTable.restaurantId)
    : eq(socialAccountsTable.restaurantId, candidate.restaurantId);
  await getSocialSettings();
  const started = Date.now();
  const result = await db.transaction(async (tx) => {
    const [settings] = await tx.select({ automation: socialSettingsTable.automation })
      .from(socialSettingsTable).where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID))
      .limit(1).for("update");
    if (!settings?.automation || !verifiedRunner()) return { reason: "automation-off" as const };
    const accounts = await tx.select({ id: socialAccountsTable.id }).from(socialAccountsTable)
      .where(and(scope, eq(socialAccountsTable.platform, candidate.platform), eq(socialAccountsTable.status, "connected")))
       .limit(candidate.platform === "tiktok" ? 2 : 1).for("update");
    if (!accounts.length || (candidate.platform === "tiktok" && !reviewedTikTokAccount(accounts, candidate.accountId))) return { reason: "no-account" as const };
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
    if (post) await tx.insert(socialLogsTable).values({ id: randomUUID(), postId: post.id, restaurantId: post.restaurantId, platform: post.platform, event: "schedule", status: "success", durationMs: Date.now() - started });
    return post ? { reason: "scheduled" as const, post } : { reason: "not-draft" as const };
  });
  if (result.reason === "automation-off") {
    res.status(409).json({ error: "Turn on master automation before scheduling a post. You can still publish a draft manually." });
    return;
  }
  if (result.reason === "no-account") {
    res.status(409).json({ error: `Connect and review exactly one ${candidate.platform} account for this post before scheduling it.` });
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
    if (error instanceof Error && (error.message === "No connected social account for this post." || error.message === "TikTok account changed. Review its privacy setting again.")) {
      res.status(409).json({ error: error.message }); return;
    }
    res.status(502).json({ error: "Social provider rejected the post." });
  }
});
router.post("/social/posts/:postId/status", async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.postId);
  if (!id.success) { res.status(400).json({ error: "Invalid post ID." }); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id.data)).limit(1);
  if (!post || post.platform !== "tiktok" || post.status !== "publishing" || !post.providerPostId) {
    res.status(409).json({ error: "No pending TikTok publish to check." }); return;
  }
  if (!post.accountId) { res.status(409).json({ error: "This post has no recorded TikTok account; check TikTok directly." }); return; }
  const accounts = await db.select().from(socialAccountsTable)
    .where(and(eq(socialAccountsTable.id, post.accountId), eq(socialAccountsTable.platform, "tiktok"), eq(socialAccountsTable.status, "connected"))).limit(1);
  const account = pendingTikTokAccount(accounts, post.accountId);
  if (!account) { res.status(409).json({ error: "Original TikTok account disconnected; check TikTok directly." }); return; }
  try {
    const status = await tiktokAdapter.status(decryptToken(account.accessToken, account.accessTokenIv, account.accessTokenTag), post.providerPostId);
    if (!["PUBLISH_COMPLETE", "FAILED"].includes(status.status)) { res.json({ post, providerStatus: status.status }); return; }
    const success = status.status === "PUBLISH_COMPLETE";
    const [updated] = await db.update(socialPostsTable).set({
      status: success ? "published" : "failed", publishedAt: success ? new Date() : null,
      errorMessage: success ? null : "TikTok reports publishing failed. Check the account before retrying.",
      updatedAt: new Date(),
    }).where(and(eq(socialPostsTable.id, post.id), eq(socialPostsTable.status, "publishing"))).returning();
    if (updated) await db.insert(socialLogsTable).values({
      id: randomUUID(), postId: post.id, accountId: account.id, restaurantId: post.restaurantId,
      platform: "tiktok", event: "status", status: success ? "success" : "failed",
      message: success ? `Publish ID: ${post.providerPostId}; Post ID: ${status.publicaly_available_post_id?.join(",") || "not returned"}` : "TikTok reports publishing failed.",
      attemptCount: post.attemptCount,
      durationMs: post.updatedAt ? Math.max(0, Date.now() - post.updatedAt.getTime()) : null,
    });
    res.json({ post: updated ?? post, providerStatus: status.status });
  } catch { res.status(502).json({ error: "TikTok status is unavailable. Do not resend; check again later." }); }
});
router.get("/social/posts", async (_req, res): Promise<void> => { res.json({ posts: await db.select().from(socialPostsTable).orderBy(desc(socialPostsTable.createdAt)) }); });
router.get("/social/logs", async (_req, res): Promise<void> => { res.json({ logs: await db.select().from(socialLogsTable).orderBy(desc(socialLogsTable.createdAt)) }); });
router.get("/social/errors", async (_req, res): Promise<void> => {
  const [total] = await db.select({ count: count() }).from(socialLogsTable)
    .where(inArray(socialLogsTable.status, ["failed", "uncertain"]));
  const errors = await db.select().from(socialLogsTable)
    .where(inArray(socialLogsTable.status, ["failed", "uncertain"]))
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
router.get("/social/health", async (_req, res): Promise<void> => {
  const settings = await getSocialSettings();
  const configured = verifiedRunner();
  const now = Date.now();
  // The external runner targets five-minute intervals; allow missed/delayed invocations,
  // but do not mistake a yesterday heartbeat for a running worker.
  const fresh = settings.workerSuccessAt && settings.workerHeartbeatAt
    && settings.workerHeartbeatAt.getTime() >= now - 20 * 60 * 1000
    && settings.workerHeartbeatAt.getTime() <= now + 5 * 60 * 1000
    && settings.workerSuccessAt.getTime() > (settings.workerFailureAt?.getTime() ?? 0);
  const since = new Date(now - 30 * 86_400_000);
  const rows = await db.select({
    event: socialLogsTable.event, status: socialLogsTable.status,
    total: count(),
    averageMs: sql<number | null>`avg(${socialLogsTable.durationMs})::float8`,
  }).from(socialLogsTable).where(gte(socialLogsTable.createdAt, since))
    .groupBy(socialLogsTable.event, socialLogsTable.status);
  const metric = (event: string, status: string) => rows.find(row => row.event === event && row.status === status);
  const total = (event: string, status: string) => metric(event, status)?.total ?? 0;
  const outcomes = total("publish", "success") + total("publish", "failed") + total("status", "success") + total("status", "failed");
  res.json({
    health: {
      state: !settings.automation ? "disabled" : !configured ? "not_configured" : fresh ? "healthy" : "configured",
      workerConfigured: configured,
      lastHeartbeatAt: settings.workerHeartbeatAt,
      lastSuccessAt: settings.workerSuccessAt,
      lastFailureAt: settings.workerFailureAt,
    },
    periodDays: 30,
    metrics: {
      generation: { succeeded: total("generate", "success"), failed: total("generate", "failed"), averageMs: metric("generate", "success")?.averageMs ?? null },
      scheduling: { succeeded: total("schedule", "success"), failed: total("schedule", "failed"), averageMs: metric("schedule", "success")?.averageMs ?? null },
      publishing: {
        attempts: total("publish", "attempt"), succeeded: total("publish", "success"),
        failed: total("publish", "failed") + total("status", "failed"),
        uncertain: total("publish", "uncertain"), pending: total("publish", "pending"),
        completed: total("status", "success"),
        successRate: outcomes ? Math.round(100 * (total("publish", "success") + total("status", "success")) / outcomes) : null,
        averageMs: metric("publish", "success")?.averageMs ?? null,
      },
    },
    capabilities: { facebookPublishing: "supported", instagramPublishing: "not_verified", tokenRefresh: "not_verified" },
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