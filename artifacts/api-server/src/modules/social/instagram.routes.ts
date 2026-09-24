import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, restaurantsTable, socialAccountsTable } from "@workspace/db";
import { encryptToken } from "./crypto";
import {
  beginInstagramLogin, consumeInstagramLogin, exchangeInstagramCode,
  instagramConfig, INSTAGRAM_CALLBACK_PATH,
} from "./instagram.oauth";

export const instagramRouter: IRouter = Router();
const ACCOUNT_PAGE = "/admin/automation/social?tab=accounts";
const finish = (reason: string) => `${ACCOUNT_PAGE}&instagram=${encodeURIComponent(reason)}`;

instagramRouter.get("/config", (_req, res) => {
  const config = instagramConfig();
  res.json({
    configured: Boolean(config),
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI?.trim() || null,
    callbackPath: INSTAGRAM_CALLBACK_PATH,
  });
});

instagramRouter.post("/start", async (req, res): Promise<void> => {
  const config = instagramConfig();
  if (!config) {
    res.status(503).json({ error: "Instagram app ID, app secret, and HTTPS redirect URI must be configured." });
    return;
  }
  const restaurantId = req.body?.restaurantId ?? null;
  if (restaurantId !== null && (typeof restaurantId !== "string" || !restaurantId.trim())) {
    res.status(400).json({ error: "A valid restaurant Place ID is required." });
    return;
  }
  if (restaurantId !== null) {
    const [restaurant] = await db.select({ id: restaurantsTable.placeId }).from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, restaurantId)).limit(1);
    if (!restaurant) { res.status(404).json({ error: "Restaurant not found." }); return; }
  }
  const state = beginInstagramLogin(res, restaurantId);
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic");
  url.searchParams.set("state", state);
  res.set("Referrer-Policy", "no-referrer");
  res.json({ authorizationUrl: url.toString() });
});

instagramRouter.get("/callback", async (req, res): Promise<void> => {
  res.set("Referrer-Policy", "no-referrer");
  const pending = consumeInstagramLogin(req, res);
  if (!pending) { res.redirect(303, finish("state_error")); return; }
  if (req.query.error) { res.redirect(303, finish("denied")); return; }
  const code = req.query.code;
  const config = instagramConfig();
  if (!config) { res.redirect(303, finish("configuration_error")); return; }
  if (typeof code !== "string" || !code || code.length > 4096) {
    res.redirect(303, finish("authorization_error")); return;
  }
  try {
    const connection = await exchangeInstagramCode(code.replace(/#_$/, ""), config);
    const encrypted = encryptToken(connection.token);
    const outcome = await db.transaction(async (tx) => {
      // Serialize callbacks for the same Instagram profile; a profile must not
      // silently move between the brand and a restaurant.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`instagram:${connection.userId}`}))`);
      const [existing] = await tx.select().from(socialAccountsTable)
        .where(and(eq(socialAccountsTable.platform, "instagram"), eq(socialAccountsTable.pageId, connection.userId)))
        .limit(1).for("update");
      if (existing && existing.restaurantId !== pending.restaurantId) return "already_used";
      if (existing) {
        await tx.update(socialAccountsTable).set({
          displayName: connection.username, accessToken: encrypted.encrypted,
          accessTokenIv: encrypted.iv, accessTokenTag: encrypted.tag,
          tokenExpiresAt: connection.expiresAt, status: "connected", updatedAt: new Date(),
        }).where(eq(socialAccountsTable.id, existing.id));
      } else {
        await tx.insert(socialAccountsTable).values({
          id: randomUUID(), platform: "instagram", pageId: connection.userId,
          displayName: connection.username, restaurantId: pending.restaurantId,
          accessToken: encrypted.encrypted, accessTokenIv: encrypted.iv, accessTokenTag: encrypted.tag,
          tokenExpiresAt: connection.expiresAt, status: "connected",
        });
      }
      return "connected";
    });
    res.redirect(303, finish(outcome));
  } catch {
    res.redirect(303, finish("authorization_error"));
  }
});