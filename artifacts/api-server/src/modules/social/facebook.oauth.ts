import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { decryptToken, encryptToken } from "./crypto";

export const FACEBOOK_CALLBACK_PATH = "/admin/social/facebook/callback";
const COOKIE_PATH = "/admin/social/facebook";
const STATE_COOKIE = "tfa_fb_oauth";
const PENDING_COOKIE = "tfa_fb_pages";
const LIFETIME = 10 * 60 * 1000;
const GRAPH = "https://graph.facebook.com/v26.0";
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: COOKIE_PATH };

export function facebookConfig() {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  const redirectUri = facebookRedirectUri();
  if (!appId || !appSecret || !redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:" || url.pathname !== FACEBOOK_CALLBACK_PATH || url.search || url.hash) return null;
  } catch { return null; }
  return { appId, appSecret, redirectUri };
}

export function facebookRedirectUri() {
  const explicit = process.env.FACEBOOK_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const instagram = process.env.INSTAGRAM_REDIRECT_URI?.trim();
  if (!instagram) return null;
  try { return new URL(FACEBOOK_CALLBACK_PATH, instagram).toString(); }
  catch { return null; }
}

export function facebookAuthorizationUrl(
  config: NonNullable<ReturnType<typeof facebookConfig>>,
  state: string,
  configId?: string,
) {
  const url = new URL("https://www.facebook.com/v26.0/dialog/oauth");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  if (configId) {
    // Business Login derives its permissions from this dashboard configuration.
    url.searchParams.set("config_id", configId);
  } else {
    url.searchParams.set("scope", "pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_metadata");
  }
  url.searchParams.set("state", state);
  return url.toString();
}

function signature(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for Facebook OAuth state.");
  return createHmac("sha256", secret).update(`facebook-oauth:${value}`).digest("base64url");
}

export function beginFacebookLogin(res: Response, restaurantId: string | null, pageId: string | null = null) {
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ state, restaurantId, pageId, expiresAt: Date.now() + LIFETIME })).toString("base64url");
  res.cookie(STATE_COOKIE, `${payload}.${signature(payload)}`, { ...cookieOptions, maxAge: LIFETIME });
  return state;
}

export function consumeFacebookLogin(req: Request, res: Response): { restaurantId: string | null; pageId: string | null } | undefined {
  res.clearCookie(STATE_COOKIE, cookieOptions);
  const value: unknown = req.cookies?.[STATE_COOKIE];
  const state: unknown = req.query.state;
  if (typeof value !== "string" || value.length > 2048 || typeof state !== "string") return undefined;
  const [payload, sig, extra] = value.split(".");
  if (!payload || !sig || extra) return undefined;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.state !== state || parsed.expiresAt < Date.now() || parsed.expiresAt > Date.now() + LIFETIME
      || !(parsed.restaurantId === null || typeof parsed.restaurantId === "string")
      || !(parsed.pageId === null || parsed.pageId === undefined || isFacebookPageId(parsed.pageId))) return undefined;
    return { restaurantId: parsed.restaurantId, pageId: parsed.pageId ?? null };
  } catch { return undefined; }
}

export function isFacebookPageId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,30}$/.test(value);
}

export function savePendingPages(res: Response, userToken: string, restaurantId: string | null, pageId: string | null = null) {
  const data = JSON.stringify({ userToken, restaurantId, pageId, expiresAt: Date.now() + LIFETIME });
  const encrypted = encryptToken(data);
  res.cookie(PENDING_COOKIE, `${encrypted.iv}.${encrypted.tag}.${encrypted.encrypted}`, { ...cookieOptions, maxAge: LIFETIME });
}

export function pendingPages(req: Request): { userToken: string; restaurantId: string | null; pageId: string | null } | null {
  const value: unknown = req.cookies?.[PENDING_COOKIE];
  if (typeof value !== "string" || value.length > 4096) return null;
  const [iv, tag, encrypted, extra] = value.split(".");
  if (!iv || !tag || !encrypted || extra) return null;
  if ([iv, tag, encrypted].some(part => Buffer.from(part, "base64").toString("base64") !== part)) return null;
  try {
    const data = JSON.parse(decryptToken(encrypted, iv, tag));
    if (typeof data.userToken !== "string" || !data.userToken
      || typeof data.expiresAt !== "number"
      || data.expiresAt < Date.now() || data.expiresAt > Date.now() + LIFETIME
      || !(data.restaurantId === null || typeof data.restaurantId === "string")
      || !(data.pageId === null || data.pageId === undefined || isFacebookPageId(data.pageId))) return null;
    return { userToken: data.userToken, restaurantId: data.restaurantId, pageId: data.pageId ?? null };
  } catch { return null; }
}

export function clearPendingPages(res: Response) { res.clearCookie(PENDING_COOKIE, cookieOptions); }

export class FacebookGraphFailure extends Error {
  readonly httpStatus: number;
  readonly providerCode: number | null;
  readonly providerSubcode: number | null;
  constructor(
    httpStatus: number,
    providerCode: number | null,
    providerSubcode: number | null,
  ) {
    super("Facebook authorization request failed.");
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
    this.providerSubcode = providerSubcode;
  }
}

async function graphRequest(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data: any = await response.json().catch(() => null);
    // Never include provider response bodies, tokens, or URLs in errors or logs.
    if (!response.ok || !data || data.error) {
      const code = data?.error?.code;
      const subcode = data?.error?.error_subcode;
      // Only numeric error identifiers are safe to log. Never log provider bodies
      // or request URLs: token-exchange URLs contain the app secret and login code.
      throw new FacebookGraphFailure(
        response.status,
        Number.isSafeInteger(code) ? code : null,
        Number.isSafeInteger(subcode) ? subcode : null,
      );
    }
    return data;
  } finally { clearTimeout(timer); }
}

export async function exchangeFacebookCode(code: string, config: NonNullable<ReturnType<typeof facebookConfig>>) {
  const shortUrl = new URL(`${GRAPH}/oauth/access_token`);
  for (const [key, value] of Object.entries({
    client_id: config.appId, client_secret: config.appSecret, redirect_uri: config.redirectUri, code,
  })) shortUrl.searchParams.set(key, value);
  const short = await graphRequest(shortUrl.toString());
  if (typeof short.access_token !== "string" || !short.access_token) throw new Error("Facebook did not return a user token.");
  const longUrl = new URL(`${GRAPH}/oauth/access_token`);
  for (const [key, value] of Object.entries({
    grant_type: "fb_exchange_token", client_id: config.appId,
    client_secret: config.appSecret, fb_exchange_token: short.access_token,
  })) longUrl.searchParams.set(key, value);
  const long = await graphRequest(longUrl.toString());
  if (typeof long.access_token !== "string" || !long.access_token) throw new Error("Facebook did not return a long-lived token.");
  return long.access_token as string;
}

export type FacebookPage = { id: string; name: string; accessToken: string };
export async function fetchFacebookPagesWithSummary(userToken: string): Promise<{
  pages: FacebookPage[];
  returnedPageCount: number;
  contentPageCount: number;
}> {
  const data = await graphRequest(`${GRAPH}/me/accounts?fields=id,name,access_token,tasks&limit=100`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (!Array.isArray(data.data)) throw new Error("Facebook did not return any Pages.");
  const contentPages = data.data.filter((page: any) =>
    typeof page.id === "string" && typeof page.name === "string"
    && Array.isArray(page.tasks) && page.tasks.includes("CREATE_CONTENT"));
  return {
    pages: contentPages.filter((page: any) => typeof page.access_token === "string" && page.access_token)
      .map((page: any) => ({ id: page.id, name: page.name, accessToken: page.access_token })),
    returnedPageCount: data.data.length,
    contentPageCount: contentPages.length,
  };
}

export async function fetchFacebookPages(userToken: string): Promise<FacebookPage[]> {
  return (await fetchFacebookPagesWithSummary(userToken)).pages;
}

export type FacebookPageCheck =
  | { status: "ready"; page: FacebookPage }
  | { status: "no_content_access" | "no_page_token" | "unverified_content" | "page_mismatch" };

// A direct Page lookup is only a candidate: do not connect it unless Meta also
// reports CREATE_CONTENT and a Page token for this same login and Page ID.
export async function checkFacebookPageById(userToken: string, pageId: string): Promise<FacebookPageCheck> {
  if (!isFacebookPageId(pageId)) throw new Error("Invalid Facebook Page ID.");
  const url = `${GRAPH}/${pageId}?fields=id,name,access_token,tasks`;
  let data: any;
  try {
    data = await graphRequest(url, { headers: { Authorization: `Bearer ${userToken}` } });
  } catch (error) {
    // Some Graph versions do not expose tasks on a Page node. A narrower
    // lookup can diagnose visibility, but never authorize a connection alone.
    if (!(error instanceof FacebookGraphFailure) || error.providerCode !== 100) throw error;
    data = await graphRequest(`${GRAPH}/${pageId}?fields=id,name,access_token`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
  }
  if (data.id !== pageId || typeof data.name !== "string") return { status: "page_mismatch" };
  if (!Array.isArray(data.tasks)) return { status: "unverified_content" };
  if (!data.tasks.includes("CREATE_CONTENT")) return { status: "no_content_access" };
  if (typeof data.access_token !== "string" || !data.access_token) return { status: "no_page_token" };
  return { status: "ready", page: { id: data.id, name: data.name, accessToken: data.access_token } };
}

export async function fetchConnectableFacebookPages(userToken: string, pageId: string | null): Promise<FacebookPage[]> {
  const pages = await fetchFacebookPages(userToken);
  if (!pageId) return pages;
  const listed = pages.find(page => page.id === pageId);
  if (listed) return [listed];
  const checked = await checkFacebookPageById(userToken, pageId);
  return checked.status === "ready" ? [checked.page] : [];
}

// Return only fixed permission flags and aggregate asset counts. Never expose
// the token debugger's user ID, Page IDs, or the raw provider response.
export async function inspectFacebookPageGrant(
  userToken: string,
  config: NonNullable<ReturnType<typeof facebookConfig>>,
) {
  const url = new URL(`${GRAPH}/debug_token`);
  url.searchParams.set("input_token", userToken);
  const result = await graphRequest(url.toString(), {
    headers: { Authorization: `Bearer ${config.appId}|${config.appSecret}` },
  });
  const data = result.data;
  if (!data || !Array.isArray(data.scopes)) throw new Error("Facebook token permissions unavailable.");
  const scopeGranted = (scope: string) => data.scopes.includes(scope);
  const targetCount = (scope: string): number | null => {
    if (!Array.isArray(data.granular_scopes)) return null;
    const granular = data.granular_scopes.find((entry: any) => entry?.scope === scope);
    return Array.isArray(granular?.target_ids) ? granular.target_ids.length : null;
  };
  return {
    tokenValid: data.is_valid === true,
    showListGranted: scopeGranted("pages_show_list"),
    showListTargetCount: targetCount("pages_show_list"),
    managePostsGranted: scopeGranted("pages_manage_posts"),
    managePostsTargetCount: targetCount("pages_manage_posts"),
    readEngagementGranted: scopeGranted("pages_read_engagement"),
    manageMetadataGranted: scopeGranted("pages_manage_metadata"),
  };
}