import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, restaurantsTable, socialAccountsTable, socialLogsTable, socialPostsTable, socialSchedulesTable } from "@workspace/db";
import { adminOnly } from "../../middleware/adminOnly";
import { encryptToken } from "./crypto";
import { facebookAdapter } from "./adapters/facebook.adapter";
import { generateRestaurantPost, generateBrandPost } from "./ai.service";
import { publishPost } from "./services/publishing.service";

const router: IRouter = Router();
router.use(adminOnly);
const publicAccount = (a: any) => ({ id: a.id, restaurantId: a.restaurantId, platform: a.platform, displayName: a.displayName, createdAt: a.createdAt, status: a.status });
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
export default router;