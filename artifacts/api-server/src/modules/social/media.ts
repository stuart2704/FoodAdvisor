import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, restaurantChefProfilesTable, socialPostsTable } from "@workspace/db";
import { streamChefObject, getChefObject, CHEF_IMAGE_TYPES, CHEF_IMAGE_MAX_BYTES } from "../../lib/chefObjectStorage";
import { assertPublicHttpsUrl } from "../../lib/public-url";

export const socialMediaRouter: IRouter = Router();

export async function approvedPhotoPath(post: {
  restaurantId: string | null;
  mediaObjectPath: string | null;
  mediaApprovedAt: Date | null;
}): Promise<string | null> {
  if (!post.restaurantId || !post.mediaApprovedAt || !post.mediaObjectPath
    || !/^\/objects\/chef\/[0-9a-f-]{36}$/.test(post.mediaObjectPath)) return null;
  const [profile] = await db.select({
    path: restaurantChefProfilesTable.photoObjectPath,
    mime: restaurantChefProfilesTable.photoMimeType,
    size: restaurantChefProfilesTable.photoSizeBytes,
  }).from(restaurantChefProfilesTable).where(and(
    eq(restaurantChefProfilesTable.restaurantId, post.restaurantId),
    eq(restaurantChefProfilesTable.moderationStatus, "approved"),
  )).limit(1);
  return profile?.path === post.mediaObjectPath
    && CHEF_IMAGE_TYPES.some((type) => type === profile.mime)
    && !!profile.size && profile.size <= CHEF_IMAGE_MAX_BYTES
    ? profile.path : null;
}

export async function photoUrl(postId: string): Promise<string> {
  const origin = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL);
  return `${origin.origin}/api/social/media/${postId}`;
}

// No token in this URL: Facebook's servers must fetch it without a session.
// Permission is enforced on each request, so revocation or profile replacement closes access.
socialMediaRouter.get("/social/media/:postId", async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.postId);
  if (!id.success) { res.status(404).end(); return; }
  const [post] = await db.select({
    restaurantId: socialPostsTable.restaurantId,
    mediaObjectPath: socialPostsTable.mediaObjectPath,
    mediaApprovedAt: socialPostsTable.mediaApprovedAt,
  }).from(socialPostsTable).where(eq(socialPostsTable.id, id.data)).limit(1);
  const path = post && await approvedPhotoPath(post);
  if (!path) { res.status(404).end(); return; }
  await streamChefObject(path, res, "public, max-age=60");
});

export async function validatePhotoObject(path: string): Promise<void> {
  const file = await getChefObject(path);
  const [metadata] = await file.getMetadata();
  if (!CHEF_IMAGE_TYPES.some((type) => type === metadata.contentType)
    || Number(metadata.size) <= 0 || Number(metadata.size) > CHEF_IMAGE_MAX_BYTES) {
    throw new Error("Chef photo is not a supported image.");
  }
}