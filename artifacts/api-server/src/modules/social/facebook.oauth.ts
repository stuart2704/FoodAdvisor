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

function signature(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for Facebook OAuth state.");
  return createHmac("sha256", secret).update(`facebook-oauth:${value}`).digest("base64url");
}

export function beginFacebookLogin(res: Response, restaurantId: string | null) {
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ state, restaurantId, expiresAt: Date.now() + LIFETIME })).toString("base64url");
  res.cookie(STATE_COOKIE, `${payload}.${signature(payload)}`, { ...cookieOptions, maxAge: LIFETIME });
  return state;
}

export function consumeFacebookLogin(req: Request, res: Response): string | null | undefined {
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
      || !(parsed.restaurantId === null || typeof parsed.restaurantId === "string")) return undefined;
    return parsed.restaurantId;
  } catch { return undefined; }
}

export function savePendingPages(res: Response, userToken: string, restaurantId: string | null) {
  const data = JSON.stringify({ userToken, restaurantId, expiresAt: Date.now() + LIFETIME });
  const encrypted = encryptToken(data);
  res.cookie(PENDING_COOKIE, `${encrypted.iv}.${encrypted.tag}.${encrypted.encrypted}`, { ...cookieOptions, maxAge: LIFETIME });
}

export function pendingPages(req: Request): { userToken: string; restaurantId: string | null } | null {
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
      || !(data.restaurantId === null || typeof data.restaurantId === "string")) return null;
    return { userToken: data.userToken, restaurantId: data.restaurantId };
  } catch { return null; }
}

export function clearPendingPages(res: Response) { res.clearCookie(PENDING_COOKIE, cookieOptions); }

async function graphRequest(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data: any = await response.json().catch(() => null);
    // Never include provider response bodies, tokens, or URLs in errors or logs.
    if (!response.ok || !data || data.error) throw new Error("Facebook authorization request failed.");
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
export async function fetchFacebookPages(userToken: string): Promise<FacebookPage[]> {
  const data = await graphRequest(`${GRAPH}/me/accounts?fields=id,name,access_token,tasks&limit=100`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (!Array.isArray(data.data)) throw new Error("Facebook did not return any Pages.");
  return data.data.filter((page: any) =>
    typeof page.id === "string" && typeof page.name === "string"
    && typeof page.access_token === "string" && Array.isArray(page.tasks)
    && page.tasks.includes("CREATE_CONTENT")
  ).map((page: any) => ({ id: page.id, name: page.name, accessToken: page.access_token }));
}