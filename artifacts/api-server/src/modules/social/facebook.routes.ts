import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, restaurantsTable, socialAccountsTable } from "@workspace/db";
import { encryptToken } from "./crypto";
import {
  beginFacebookLogin, clearPendingPages, consumeFacebookLogin, exchangeFacebookCode,
  facebookConfig, facebookRedirectUri, fetchFacebookPages, pendingPages, savePendingPages, FACEBOOK_CALLBACK_PATH,
} from "./facebook.oauth";

export const facebookRouter: IRouter = Router();
const ACCOUNT_PAGE = "/admin/automation/social?tab=accounts";
const finish = (result: string) => `${ACCOUNT_PAGE}&facebook=${encodeURIComponent(result)}`;

facebookRouter.get("/config", (_req, res) => {
  res.json({
    configured: Boolean(facebookConfig()),
    redirectUri: facebookRedirectUri(),
    callbackPath: FACEBOOK_CALLBACK_PATH,
  });
});

facebookRouter.post("/start", async (req, res): Promise<void> => {
  const config = facebookConfig();
  if (!config) { res.status(503).json({ error: "Facebook app ID, app secret, and HTTPS redirect URI must be configured." }); return; }
  const restaurantId: unknown = req.body?.restaurantId ?? null;
  if (restaurantId !== null && (typeof restaurantId !== "string" || !restaurantId.trim())) {
    res.status(400).json({ error: "A valid restaurant Place ID is required." }); return;
  }
  if (restaurantId !== null) {
    const [restaurant] = await db.select({ id: restaurantsTable.placeId }).from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, restaurantId)).limit(1);
    if (!restaurant) { res.status(404).json({ error: "Restaurant not found." }); return; }
  }
  clearPendingPages(res);
  const state = beginFacebookLogin(res, restaurantId);
  const url = new URL("https://www.facebook.com/v26.0/dialog/oauth");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_metadata");
  if (process.env.FACEBOOK_CONFIG_ID?.trim()) url.searchParams.set("config_id", process.env.FACEBOOK_CONFIG_ID.trim());
  url.searchParams.set("state", state);
  res.set("Referrer-Policy", "no-referrer");
  res.json({ authorizationUrl: url.toString() });
});

facebookRouter.get("/callback", async (req, res): Promise<void> => {
  res.set("Referrer-Policy", "no-referrer");
  const restaurantId = consumeFacebookLogin(req, res);
  if (restaurantId === undefined) { res.redirect(303, finish("state_error")); return; }
  if (req.query.error) { res.redirect(303, finish("denied")); return; }
  const config = facebookConfig();
  if (!config) { res.redirect(303, finish("configuration_error")); return; }
  const code = req.query.code;
  if (typeof code !== "string" || !code || code.length > 4096) {
    res.redirect(303, finish("authorization_error")); return;
  }
  try {
    const userToken = await exchangeFacebookCode(code, config);
    const pages = await fetchFacebookPages(userToken);
    if (pages.length === 0) { res.redirect(303, finish("no_pages")); return; }
    savePendingPages(res, userToken, restaurantId);
    res.redirect(303, finish("select"));
  } catch {
    res.redirect(303, finish("authorization_error"));
  }
});

facebookRouter.get("/pages", async (req, res): Promise<void> => {
  const pending = pendingPages(req);
  if (!pending) { res.status(410).json({ error: "Facebook Page selection expired. Connect again." }); return; }
  try {
    const pages = await fetchFacebookPages(pending.userToken);
    res.json({ pages: pages.map(({ id, name }) => ({ id, name })) });
  } catch {
    res.status(502).json({ error: "Could not load your Facebook Pages. Try connecting again." });
  }
});

facebookRouter.post("/finish", async (req, res): Promise<void> => {
  const pending = pendingPages(req);
  if (!pending) { res.status(410).json({ error: "Facebook Page selection expired. Connect again." }); return; }
  const pageId: unknown = req.body?.pageId;
  if (typeof pageId !== "string" || !/^\d{1,30}$/.test(pageId)) {
    res.status(400).json({ error: "Choose a valid Facebook Page." }); return;
  }
  try {
    const page = (await fetchFacebookPages(pending.userToken)).find(item => item.id === pageId);
    if (!page) { res.status(403).json({ error: "You do not have permission to publish to that Page." }); return; }
    const encrypted = encryptToken(page.accessToken);
    const outcome = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`facebook:${page.id}`}))`);
      const [existing] = await tx.select().from(socialAccountsTable)
        .where(and(eq(socialAccountsTable.platform, "facebook"), eq(socialAccountsTable.pageId, page.id)))
        .limit(1).for("update");
      if (existing && existing.restaurantId !== pending.restaurantId) return "already_used";
      if (existing) {
        await tx.update(socialAccountsTable).set({
          displayName: page.name, accessToken: encrypted.encrypted,
          accessTokenIv: encrypted.iv, accessTokenTag: encrypted.tag,
          tokenExpiresAt: null, status: "connected", updatedAt: new Date(),
        }).where(eq(socialAccountsTable.id, existing.id));
      } else {
        await tx.insert(socialAccountsTable).values({
          id: randomUUID(), restaurantId: pending.restaurantId, platform: "facebook",
          pageId: page.id, displayName: page.name,
          accessToken: encrypted.encrypted, accessTokenIv: encrypted.iv,
          accessTokenTag: encrypted.tag, status: "connected",
        });
      }
      return "connected";
    });
    if (outcome === "already_used") { res.status(409).json({ error: "This Facebook Page is already connected to another brand or restaurant." }); return; }
    clearPendingPages(res);
    res.json({ success: true, pageName: page.name });
  } catch {
    res.status(502).json({ error: "Could not connect the Facebook Page. Please try again." });
  }
});