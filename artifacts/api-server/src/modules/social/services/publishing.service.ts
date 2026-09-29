import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, socialAccountsTable, socialLogsTable, socialPostsTable, socialSettingsTable } from "@workspace/db";
import { decryptToken, encryptToken } from "../crypto";
import { facebookAdapter } from "../adapters/facebook.adapter";
import { instagramAdapter } from "../adapters/instagram.adapter";
import { tiktokAdapter } from "../adapters/tiktok.adapter";
import { tiktokConfig } from "../tiktok.oauth";
import { SOCIAL_SETTINGS_ID } from "../settings";
import { approvedPhotoPath } from "../media";
import { reviewedTikTokAccount } from "../tiktok-account";

export async function publishPost(postId: string, options: { scheduledOnly?: boolean } = {}) {
  const [candidate] = await db.select().from(socialPostsTable)
    .where(eq(socialPostsTable.id, postId)).limit(1);
  if (!candidate || (options.scheduledOnly
    ? candidate.status !== "scheduled"
    : !["draft", "scheduled"].includes(candidate.status))) return null;

  const scope = candidate.restaurantId === null
    ? isNull(socialAccountsTable.restaurantId)
    : eq(socialAccountsTable.restaurantId, candidate.restaurantId);
  const accounts = await db.select().from(socialAccountsTable)
    .where(and(scope, eq(socialAccountsTable.platform, candidate.platform), eq(socialAccountsTable.status, "connected"),
      candidate.platform === "facebook" && candidate.accountId ? eq(socialAccountsTable.id, candidate.accountId) : undefined))
    .orderBy(desc(socialAccountsTable.createdAt)).limit(candidate.platform === "tiktok" ? 2 : 1);
  const account = accounts[0];
  if (!account) throw new Error("No connected social account for this post.");
  if (candidate.platform === "tiktok" && (!candidate.accountId || !reviewedTikTokAccount(accounts, candidate.accountId)))
    throw new Error("TikTok account changed. Review its privacy setting again.");
  if (!["facebook", "instagram", "tiktok"].includes(candidate.platform)) throw new Error("Unsupported platform.");
  if (candidate.platform !== "facebook" && (!candidate.mediaUrl || !candidate.mediaApprovedAt || !await approvedPhotoPath(candidate)))
    throw new Error("An approved chef photo is required for this platform.");
  if (candidate.platform === "tiktok" && !candidate.privacyLevel)
    throw new Error("Choose a TikTok privacy level before publishing.");
  if (candidate.mediaUrl && candidate.mediaObjectPath && !(await approvedPhotoPath(candidate))) {
    throw new Error("Approved chef photo is no longer available. Review this draft before publishing.");
  }

  // Resolve prerequisites before claiming: a configuration error must not strand a draft.
  let token = decryptToken(account.accessToken, account.accessTokenIv, account.accessTokenTag);
  if (account.platform === "instagram" && account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < 7 * 86_400_000) {
    if (account.tokenExpiresAt <= new Date()) throw new Error("Instagram token expired. Reconnect this account.");
    const refreshed = await instagramAdapter.refreshToken(token);
    const encrypted = encryptToken(refreshed.token);
    const [saved] = await db.update(socialAccountsTable).set({
      accessToken: encrypted.encrypted, accessTokenIv: encrypted.iv, accessTokenTag: encrypted.tag,
      tokenExpiresAt: refreshed.expiresAt, updatedAt: new Date(),
    }).where(and(eq(socialAccountsTable.id, account.id), eq(socialAccountsTable.accessToken, account.accessToken))).returning();
    if (!saved) throw new Error("Instagram credentials changed. Retry after checking the account.");
    token = refreshed.token;
  }
  if (account.platform === "tiktok" && account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < 10 * 60_000) {
    const config = tiktokConfig();
    const parts = account.refreshToken?.split(".");
    if (!config || !parts || parts.length !== 3) throw new Error("TikTok credentials are unavailable. Reconnect this account.");
    const refresh = decryptToken(parts[2]!, parts[0]!, parts[1]!);
    const next = await tiktokAdapter.refreshToken(refresh, config.clientKey, config.clientSecret);
    const encrypted = encryptToken(next.token), encryptedRefresh = encryptToken(next.refreshToken);
    const [saved] = await db.update(socialAccountsTable).set({
      accessToken: encrypted.encrypted, accessTokenIv: encrypted.iv, accessTokenTag: encrypted.tag,
      refreshToken: `${encryptedRefresh.iv}.${encryptedRefresh.tag}.${encryptedRefresh.encrypted}`,
      tokenExpiresAt: next.expiresAt, updatedAt: new Date(),
    }).where(and(eq(socialAccountsTable.id, account.id), eq(socialAccountsTable.refreshToken, account.refreshToken!))).returning();
    if (!saved) throw new Error("TikTok credentials changed. Retry after checking the account.");
    token = next.token;
  }
  const [claimed] = options.scheduledOnly
    ? await db.transaction(async (tx) => {
      // Serialize with the master OFF action before claiming a due post.
      const [settings] = await tx.select({ automation: socialSettingsTable.automation })
        .from(socialSettingsTable).where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID))
        .limit(1).for("update");
      if (!settings?.automation
        || process.env.SOCIAL_AUTOMATION_ENABLED !== "true"
        || process.env.SOCIAL_EXTERNAL_SCHEDULER_VERIFIED !== "true") return [];
      const claimed = await tx.update(socialPostsTable)
        .set({ status: "publishing", attemptCount: candidate.attemptCount + 1, updatedAt: new Date() })
        .where(and(eq(socialPostsTable.id, postId), eq(socialPostsTable.status, "scheduled")))
        .returning();
      if (claimed[0]) await tx.insert(socialLogsTable).values({ id: randomUUID(), postId, accountId: account.id, restaurantId: claimed[0].restaurantId, platform: claimed[0].platform, event: "publish", status: "attempt", attemptCount: claimed[0].attemptCount });
      return claimed;
    })
    : await db.transaction(async (tx) => {
      const claimed = await tx.update(socialPostsTable)
      .set({ status: "publishing", attemptCount: candidate.attemptCount + 1, updatedAt: new Date() })
      .where(and(eq(socialPostsTable.id, postId), inArray(socialPostsTable.status, ["draft", "scheduled"])))
      .returning();
      if (claimed[0]) await tx.insert(socialLogsTable).values({ id: randomUUID(), postId, accountId: account.id, restaurantId: claimed[0].restaurantId, platform: claimed[0].platform, event: "publish", status: "attempt", attemptCount: claimed[0].attemptCount });
      return claimed;
    });
  if (!claimed) return null;

  const started = Date.now();
  let providerPostId: string;
  try {
    const input = { token, pageId: account.pageId ?? undefined, content: claimed.content, mediaUrl: claimed.mediaUrl ?? undefined };
    const result = claimed.platform === "facebook"
      ? await facebookAdapter.publishPhoto(input)
      : claimed.platform === "instagram"
        ? await instagramAdapter.publishPhoto(input)
        : await tiktokAdapter.publishPhoto({ ...input, privacyLevel: claimed.privacyLevel! });
    providerPostId = result.providerPostId;
  } catch {
    // A timeout can mean the provider accepted the post. Never automatically retry.
    const message = `${claimed.platform} publishing failed or its outcome is uncertain. Check the provider account before making another post.`;
    await db.update(socialPostsTable)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(and(eq(socialPostsTable.id, postId), eq(socialPostsTable.status, "publishing")));
    await db.insert(socialLogsTable).values({
      id: randomUUID(), postId, accountId: account.id, restaurantId: claimed.restaurantId,
      platform: claimed.platform, event: "publish", status: "uncertain",
      message, attemptCount: claimed.attemptCount, durationMs: Date.now() - started,
    });
    throw new Error(message);
  }

  // Do not mark this as failed if persistence fails after a provider accepted it.
  // It stays "publishing" (uncertain) and cannot be submitted again automatically.
  const pending = claimed.platform === "tiktok";
  const [post] = await db.update(socialPostsTable)
    .set({ status: pending ? "publishing" : "published", providerPostId, publishedAt: pending ? null : new Date(), errorMessage: null, updatedAt: new Date() })
    .where(and(eq(socialPostsTable.id, postId), eq(socialPostsTable.status, "publishing")))
    .returning();
  await db.insert(socialLogsTable).values({
    id: randomUUID(), postId, accountId: account.id, restaurantId: claimed.restaurantId,
    platform: claimed.platform, event: "publish", status: pending ? "pending" : "success", message: `Provider ID: ${providerPostId}`, attemptCount: claimed.attemptCount, durationMs: Date.now() - started,
  });
  return post;
}