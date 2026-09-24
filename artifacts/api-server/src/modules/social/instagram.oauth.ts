import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export const INSTAGRAM_CALLBACK_PATH = "/admin/social/instagram/callback";
const STATE_COOKIE = "tfa_ig_oauth";
const STATE_LIFETIME_MS = 10 * 60 * 1000;

type PendingConnection = { nonce: string; restaurantId: string | null; expiresAt: number };

export function instagramConfig() {
  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI?.trim();
  if (!appId || !appSecret || !redirectUri) return null;
  let url: URL;
  try { url = new URL(redirectUri); } catch { return null; }
  if (url.protocol !== "https:" || url.pathname !== INSTAGRAM_CALLBACK_PATH || url.search || url.hash) return null;
  return { appId, appSecret, redirectUri };
}

function sign(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for Instagram OAuth state.");
  return createHmac("sha256", secret).update(`instagram-oauth:${payload}`).digest("base64url");
}

const cookieOptions = {
  httpOnly: true, secure: true, sameSite: "lax" as const,
  path: INSTAGRAM_CALLBACK_PATH,
};

export function beginInstagramLogin(res: Response, restaurantId: string | null): string {
  const nonce = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    nonce, restaurantId, expiresAt: Date.now() + STATE_LIFETIME_MS,
  } satisfies PendingConnection)).toString("base64url");
  res.cookie(STATE_COOKIE, `${payload}.${sign(payload)}`, { ...cookieOptions, maxAge: STATE_LIFETIME_MS });
  return nonce;
}

export function consumeInstagramLogin(req: Request, res: Response): PendingConnection | null {
  res.clearCookie(STATE_COOKIE, cookieOptions);
  const cookie: unknown = req.cookies?.[STATE_COOKIE];
  const state: unknown = req.query.state;
  if (typeof cookie !== "string" || cookie.length > 2048 || typeof state !== "string" || state.length > 256) return null;
  const [payload, signature, extra] = cookie.split(".");
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data !== "object") return null;
    const pending = data as Partial<PendingConnection>;
    if (pending.nonce !== state || typeof pending.expiresAt !== "number"
      || pending.expiresAt < Date.now() || pending.expiresAt > Date.now() + STATE_LIFETIME_MS
      || !(pending.restaurantId === null || typeof pending.restaurantId === "string")) return null;
    return pending as PendingConnection;
  } catch { return null; }
}

async function instagramRequest(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data: any = await response.json().catch(() => null);
    // Provider errors may contain codes or credentials. Never expose the body or URL in logs.
    if (!response.ok || !data || data.error || data.error_type) throw new Error("Instagram authorization request failed.");
    return data;
  } finally { clearTimeout(timer); }
}

export async function exchangeInstagramCode(code: string, config: NonNullable<ReturnType<typeof instagramConfig>>) {
  const short = await instagramRequest("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.appId, client_secret: config.appSecret,
      grant_type: "authorization_code", redirect_uri: config.redirectUri, code,
    }),
  });
  const result = Array.isArray(short.data) ? short.data[0] : short;
  if (typeof result?.access_token !== "string" || !result.access_token
    || (result.permissions && !String(result.permissions).split(",").map((permission: string) => permission.trim()).includes("instagram_business_basic"))) {
    throw new Error("Instagram did not grant the required profile permission.");
  }
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("access_token", result.access_token);
  const long = await instagramRequest(url.toString());
  if (typeof long.access_token !== "string" || !long.access_token
    || !Number.isFinite(long.expires_in) || long.expires_in <= 0) {
    throw new Error("Instagram did not return a valid long-lived token.");
  }
  const profile = await instagramRequest("https://graph.instagram.com/me?fields=user_id,username,account_type", {
    headers: { Authorization: `Bearer ${long.access_token}` },
  });
  if (typeof profile.user_id !== "string" && typeof profile.user_id !== "number") {
    throw new Error("Instagram did not return a professional account ID.");
  }
  if (typeof profile.username !== "string" || !["BUSINESS", "MEDIA_CREATOR"].includes(profile.account_type)) {
    throw new Error("A Business or Creator Instagram account is required.");
  }
  return {
    userId: String(profile.user_id),
    username: profile.username,
    token: long.access_token as string,
    expiresAt: new Date(Date.now() + long.expires_in * 1000),
  };
}