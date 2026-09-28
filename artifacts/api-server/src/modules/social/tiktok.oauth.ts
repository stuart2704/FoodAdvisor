import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { tiktokRequest } from "./adapters/tiktok.adapter.ts";

export const TIKTOK_CALLBACK_PATH = "/admin/social/tiktok/callback";
const COOKIE = "tfa_tiktok_oauth";
const OPTIONS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: TIKTOK_CALLBACK_PATH };
const TTL = 600_000;
export function tiktokConfig() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  const redirectUri = process.env.TIKTOK_REDIRECT_URI?.trim();
  if (!clientKey || !clientSecret || !redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:" || url.pathname !== TIKTOK_CALLBACK_PATH || url.search || url.hash) return null;
  } catch { return null; }
  return { clientKey, clientSecret, redirectUri };
}
function sign(value: string) {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required.");
  return createHmac("sha256", process.env.SESSION_SECRET).update(`tiktok-oauth:${value}`).digest("base64url");
}
export function beginTikTokLogin(res: Response, restaurantId: string | null) {
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ state, restaurantId, expires: Date.now() + TTL })).toString("base64url");
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { ...OPTIONS, maxAge: TTL });
  return state;
}
export function consumeTikTokLogin(req: Request, res: Response): { restaurantId: string | null } | null {
  res.clearCookie(COOKIE, OPTIONS);
  const value: unknown = req.cookies?.[COOKIE];
  if (typeof value !== "string" || value.length > 2048 || typeof req.query.state !== "string") return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const a = Buffer.from(sign(payload)), b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.state !== req.query.state || typeof data.expires !== "number"
      || data.expires < Date.now() || data.expires > Date.now() + TTL
      || !(data.restaurantId === null || typeof data.restaurantId === "string")) return null;
    return { restaurantId: data.restaurantId };
  } catch { return null; }
}
export async function exchangeTikTokCode(code: string, config: NonNullable<ReturnType<typeof tiktokConfig>>) {
  const result = await tiktokRequest("/v2/oauth/token/", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret,
      code, grant_type: "authorization_code", redirect_uri: config.redirectUri }),
  });
  if (typeof result.access_token !== "string" || typeof result.refresh_token !== "string"
    || typeof result.open_id !== "string" || !Number.isFinite(result.expires_in)
    || !String(result.scope).split(",").includes("video.publish"))
    throw new Error("TikTok publishing permission was not granted.");
  const profile = await tiktokRequest("/v2/user/info/?fields=open_id,display_name", {
    headers: { Authorization: `Bearer ${result.access_token}` },
  });
  if (profile.data?.user?.open_id !== result.open_id) throw new Error("TikTok account could not be verified.");
  return { userId: result.open_id as string, displayName: String(profile.data.user.display_name || result.open_id),
    token: result.access_token as string, refreshToken: result.refresh_token as string,
    expiresAt: new Date(Date.now() + result.expires_in * 1000) };
}