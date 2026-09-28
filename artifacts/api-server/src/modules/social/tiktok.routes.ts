import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, restaurantsTable, socialAccountsTable } from "@workspace/db";
import { encryptToken } from "./crypto";
import { beginTikTokLogin, consumeTikTokLogin, exchangeTikTokCode, tiktokConfig, TIKTOK_CALLBACK_PATH } from "./tiktok.oauth";

export const tiktokRouter: IRouter = Router();
const finish = (result: string) => `/admin/automation/social?tab=accounts&tiktok=${encodeURIComponent(result)}`;
tiktokRouter.get("/config", (_req, res) => res.json({
  configured: Boolean(tiktokConfig()), redirectUri: process.env.TIKTOK_REDIRECT_URI?.trim() || null,
  callbackPath: TIKTOK_CALLBACK_PATH,
}));
tiktokRouter.post("/start", async (req, res): Promise<void> => {
  const config = tiktokConfig();
  if (!config) { res.status(503).json({ error: "TikTok Login Kit and HTTPS redirect URI must be configured." }); return; }
  const restaurantId = req.body?.restaurantId;
  if (typeof restaurantId !== "string" || !restaurantId.trim()) { res.status(400).json({ error: "A restaurant Place ID is required for photo posting." }); return; }
  const [r] = await db.select({ id: restaurantsTable.placeId }).from(restaurantsTable).where(eq(restaurantsTable.placeId, restaurantId)).limit(1);
  if (!r) { res.status(404).json({ error: "Restaurant not found." }); return; }
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "user.info.basic,video.publish");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", beginTikTokLogin(res, restaurantId));
  res.set("Referrer-Policy", "no-referrer");
  res.json({ authorizationUrl: url.toString() });
});
tiktokRouter.get("/callback", async (req, res): Promise<void> => {
  res.set("Referrer-Policy", "no-referrer");
  const pending = consumeTikTokLogin(req, res);
  if (!pending) { res.redirect(303, finish("state_error")); return; }
  if (req.query.error) { res.redirect(303, finish("denied")); return; }
  const config = tiktokConfig();
  if (!config || typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 4096) {
    res.redirect(303, finish("authorization_error")); return;
  }
  try {
    const connection = await exchangeTikTokCode(req.query.code, config);
    const access = encryptToken(connection.token), refresh = encryptToken(connection.refreshToken);
    const outcome = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tiktok:${connection.userId}`}))`);
      const [existing] = await tx.select().from(socialAccountsTable)
        .where(and(eq(socialAccountsTable.platform, "tiktok"), eq(socialAccountsTable.pageId, connection.userId))).limit(1).for("update");
      if (existing && existing.restaurantId !== pending.restaurantId) return "already_used";
      const values = { displayName: connection.displayName, accessToken: access.encrypted,
        accessTokenIv: access.iv, accessTokenTag: access.tag,
        refreshToken: `${refresh.iv}.${refresh.tag}.${refresh.encrypted}`,
        tokenExpiresAt: connection.expiresAt, status: "connected", updatedAt: new Date() };
      if (existing) await tx.update(socialAccountsTable).set(values).where(eq(socialAccountsTable.id, existing.id));
      else await tx.insert(socialAccountsTable).values({ ...values, id: randomUUID(), platform: "tiktok",
        pageId: connection.userId, restaurantId: pending.restaurantId });
      return "connected";
    });
    res.redirect(303, finish(outcome));
  } catch { res.redirect(303, finish("authorization_error")); }
});