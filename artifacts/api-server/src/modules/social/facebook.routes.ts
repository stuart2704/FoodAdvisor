import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, restaurantsTable, socialAccountsTable } from "@workspace/db";
import { encryptToken } from "./crypto";
import {
  beginFacebookLogin, clearPendingPages, consumeFacebookLogin, exchangeFacebookCode,
  facebookAuthorizationUrl, facebookConfig, facebookRedirectUri, FacebookGraphFailure,
  checkFacebookPageById, fetchConnectableFacebookPages, fetchFacebookPagesWithSummary,
  inspectFacebookPageGrant, isFacebookPageId,
  pendingPages, savePendingPages, FACEBOOK_CALLBACK_PATH,
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
  const pageId: unknown = req.body?.pageId ?? null;
  if (pageId !== null && !isFacebookPageId(pageId)) {
    res.status(400).json({ error: "Enter a valid numeric Facebook Page ID, or leave it blank." }); return;
  }
  clearPendingPages(res);
  const state = beginFacebookLogin(res, restaurantId, pageId);
  const url = facebookAuthorizationUrl(config, state, process.env.FACEBOOK_CONFIG_ID?.trim());
  res.set("Referrer-Policy", "no-referrer");
  res.json({ authorizationUrl: url });
});

facebookRouter.get("/callback", async (req, res): Promise<void> => {
  res.set("Referrer-Policy", "no-referrer");
  const login = consumeFacebookLogin(req, res);
  if (login === undefined) { res.redirect(303, finish("state_error")); return; }
  if (req.query.error) { res.redirect(303, finish("denied")); return; }
  const config = facebookConfig();
  if (!config) { res.redirect(303, finish("configuration_error")); return; }
  const code = req.query.code;
  if (typeof code !== "string" || !code || code.length > 4096) {
    res.redirect(303, finish("missing_code")); return;
  }
  let userToken: string;
  try {
    userToken = await exchangeFacebookCode(code, config);
  } catch (error) {
    req.log.warn({
      phase: "token_exchange",
      ...(error instanceof FacebookGraphFailure ? {
        httpStatus: error.httpStatus,
        providerCode: error.providerCode,
        providerSubcode: error.providerSubcode,
      } : {}),
    }, "Facebook connection failed");
    res.redirect(303, finish("token_error"));
    return;
  }
  try {
    const { pages, returnedPageCount, contentPageCount } = await fetchFacebookPagesWithSummary(userToken);
    if (login.pageId && !pages.some(page => page.id === login.pageId)) {
      try {
        const checked = await checkFacebookPageById(userToken, login.pageId);
        // Status only; never log Page identifiers or raw provider responses.
        req.log.info({ status: checked.status }, "Facebook direct Page check completed");
        if (checked.status !== "ready") {
          const reason = checked.status === "page_mismatch" ? "direct_page_error"
            : checked.status === "unverified_content" ? "direct_unverified"
            : checked.status === "no_page_token" ? "direct_no_token" : "direct_no_content";
          res.redirect(303, finish(reason));
          return;
        }
      } catch (error) {
        req.log.warn({
          phase: "direct_page_check",
          ...(error instanceof FacebookGraphFailure ? {
            httpStatus: error.httpStatus,
            providerCode: error.providerCode,
            providerSubcode: error.providerSubcode,
          } : {}),
        }, "Facebook direct Page check unavailable");
        res.redirect(303, finish("direct_page_error"));
        return;
      }
    }
    if (login.pageId) {
      savePendingPages(res, userToken, login.restaurantId, login.pageId);
      res.redirect(303, finish("select"));
      return;
    }
    if (pages.length === 0) {
      // Aggregate counts only: never log Page names, IDs, tokens, or Graph response bodies.
      req.log.info({ returnedPageCount, contentPageCount }, "Facebook returned no connectable Pages");
      if (returnedPageCount === 0) {
        try {
          const grant = await inspectFacebookPageGrant(userToken, config);
          req.log.info(grant, "Facebook empty Page list token grant summary");
        } catch (error) {
          req.log.warn({
            phase: "token_grant_diagnostic",
            ...(error instanceof FacebookGraphFailure ? {
              httpStatus: error.httpStatus,
              providerCode: error.providerCode,
              providerSubcode: error.providerSubcode,
            } : {}),
          }, "Facebook token grant diagnostic unavailable");
        }
      }
      const reason = returnedPageCount === 0 ? "no_pages"
        : contentPageCount === 0 ? "no_content_access" : "no_page_token";
      res.redirect(303, finish(reason));
      return;
    }
    savePendingPages(res, userToken, login.restaurantId);
    res.redirect(303, finish("select"));
  } catch (error) {
    req.log.warn({
      phase: "page_list",
      ...(error instanceof FacebookGraphFailure ? {
        httpStatus: error.httpStatus,
        providerCode: error.providerCode,
        providerSubcode: error.providerSubcode,
      } : {}),
    }, "Facebook connection failed");
    res.redirect(303, finish("page_access_error"));
  }
});

facebookRouter.get("/pages", async (req, res): Promise<void> => {
  const pending = pendingPages(req);
  if (!pending) { res.status(410).json({ error: "Facebook Page selection expired. Connect again." }); return; }
  try {
    const pages = await fetchConnectableFacebookPages(pending.userToken, pending.pageId);
    res.json({ pages: pages.map(({ id, name }) => ({ id, name })) });
  } catch {
    res.status(502).json({ error: "Could not load your Facebook Pages. Try connecting again." });
  }
});

facebookRouter.post("/finish", async (req, res): Promise<void> => {
  const pending = pendingPages(req);
  if (!pending) { res.status(410).json({ error: "Facebook Page selection expired. Connect again." }); return; }
  const pageId: unknown = req.body?.pageId;
  if (!isFacebookPageId(pageId) || (pending.pageId && pageId !== pending.pageId)) {
    res.status(400).json({ error: "Choose a valid Facebook Page." }); return;
  }
  try {
    const page = (await fetchConnectableFacebookPages(pending.userToken, pending.pageId)).find(item => item.id === pageId);
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