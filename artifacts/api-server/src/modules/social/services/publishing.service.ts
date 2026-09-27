import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, socialAccountsTable, socialLogsTable, socialPostsTable, socialSettingsTable } from "@workspace/db";
import { decryptToken } from "../crypto";
import { facebookAdapter } from "../adapters/facebook.adapter";
import { SOCIAL_SETTINGS_ID } from "../settings";
import { approvedPhotoPath } from "../media";

export async function publishPost(postId: string, options: { scheduledOnly?: boolean } = {}) {
  const [candidate] = await db.select().from(socialPostsTable)
    .where(eq(socialPostsTable.id, postId)).limit(1);
  if (!candidate || (options.scheduledOnly
    ? candidate.status !== "scheduled"
    : !["draft", "scheduled"].includes(candidate.status))) return null;

  const scope = candidate.restaurantId === null
    ? isNull(socialAccountsTable.restaurantId)
    : eq(socialAccountsTable.restaurantId, candidate.restaurantId);
  const [account] = await db.select().from(socialAccountsTable)
    .where(and(scope, eq(socialAccountsTable.platform, candidate.platform), eq(socialAccountsTable.status, "connected")))
    .orderBy(desc(socialAccountsTable.createdAt)).limit(1);
  if (!account) throw new Error("No connected social account for this post.");
  if (candidate.platform !== "facebook") throw new Error("Publishing to this platform is not supported yet.");
  if (candidate.mediaUrl && candidate.mediaObjectPath
    && !(await approvedPhotoPath(candidate))) {
    throw new Error("Approved chef photo is no longer available. Review this draft before publishing.");
  }

  // Resolve prerequisites before claiming: a configuration error must not strand a draft.
  const token = decryptToken(account.accessToken, account.accessTokenIv, account.accessTokenTag);
  const [claimed] = options.scheduledOnly
    ? await db.transaction(async (tx) => {
      // Serialize with the master OFF action before claiming a due post.
      const [settings] = await tx.select({ automation: socialSettingsTable.automation })
        .from(socialSettingsTable).where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID))
        .limit(1).for("update");
      if (!settings?.automation) return [];
      return tx.update(socialPostsTable)
        .set({ status: "publishing", attemptCount: candidate.attemptCount + 1, updatedAt: new Date() })
        .where(and(eq(socialPostsTable.id, postId), eq(socialPostsTable.status, "scheduled")))
        .returning();
    })
    : await db.update(socialPostsTable)
      .set({ status: "publishing", attemptCount: candidate.attemptCount + 1, updatedAt: new Date() })
      .where(and(eq(socialPostsTable.id, postId), inArray(socialPostsTable.status, ["draft", "scheduled"])))
      .returning();
  if (!claimed) return null;

  let providerPostId: string;
  try {
    const result = await facebookAdapter.publishPhoto({
      token,
      pageId: account.pageId ?? undefined,
      content: claimed.content,
      mediaUrl: claimed.mediaUrl ?? undefined,
    });
    providerPostId = result.providerPostId;
  } catch {
    // A timeout can mean the provider accepted the post. Never automatically retry.
    const message = "Facebook publishing failed or its outcome is uncertain. Check the Page before making another post.";
    await db.update(socialPostsTable)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(and(eq(socialPostsTable.id, postId), eq(socialPostsTable.status, "publishing")));
    await db.insert(socialLogsTable).values({
      id: randomUUID(), postId, accountId: account.id, restaurantId: claimed.restaurantId,
      platform: claimed.platform, event: "publish", status: "failed",
      message, attemptCount: claimed.attemptCount,
    });
    throw new Error(message);
  }

  // Do not mark this as failed if persistence fails after Facebook accepted it.
  // It stays "publishing" (uncertain) and cannot be submitted again automatically.
  const [post] = await db.update(socialPostsTable)
    .set({ status: "published", providerPostId, publishedAt: new Date(), errorMessage: null, updatedAt: new Date() })
    .where(and(eq(socialPostsTable.id, postId), eq(socialPostsTable.status, "publishing")))
    .returning();
  await db.insert(socialLogsTable).values({
    id: randomUUID(), postId, accountId: account.id, restaurantId: claimed.restaurantId,
    platform: claimed.platform, event: "publish", status: "success", attemptCount: claimed.attemptCount,
  });
  return post;
}