import { and, eq, lte } from "drizzle-orm";
import { db, socialPostsTable } from "@workspace/db";
import { publishPost } from "../services/publishing.service";
export async function publishPostsJob(now = new Date()): Promise<void> {
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true") return;
  const posts = await db.select({ id: socialPostsTable.id }).from(socialPostsTable).where(and(eq(socialPostsTable.status, "scheduled"), lte(socialPostsTable.scheduledFor, now)));
  for (const post of posts) await publishPost(post.id).catch(() => undefined);
}