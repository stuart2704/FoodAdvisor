import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, socialAccountsTable, socialLogsTable, socialPostsTable } from "@workspace/db";
import { decryptToken } from "../crypto";
import { facebookAdapter } from "../adapters/facebook.adapter";

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

  // Resolve prerequisites before claiming: a configuration error must not strand a draft.
  const token = decryptToken(account.accessToken, account.accessTokenIv, account.accessTokenTag);
  const [claimed] = await db.update(socialPostsTable)
    .set({ status: "publishing", attemptCount: candidate.attemptCount + 1, updatedAt: new Date() })
    .where(and(eq(socialPostsTable.id, postId), options.scheduledOnly
      ? eq(socialPostsTable.status, "scheduled")
      : inArray(socialPostsTable.status, ["draft", "scheduled"])))
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