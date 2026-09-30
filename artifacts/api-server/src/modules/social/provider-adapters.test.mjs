import assert from "node:assert/strict";
import { test } from "node:test";
import { instagramAdapter } from "./adapters/instagram.adapter.ts";
import { tiktokAdapter } from "./adapters/tiktok.adapter.ts";
import { beginTikTokLogin, consumeTikTokLogin, exchangeTikTokCode } from "./tiktok.oauth.ts";

test("Instagram rejects text-only posts and publishes an approved image after container readiness", async () => {
  await assert.rejects(instagramAdapter.publishPhoto({ token: "test", pageId: "123", content: "hello" }), /image/);
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/media")) return Response.json({ id: "container-123" });
      if (String(url).includes("container-123?fields=status_code")) return Response.json({ status_code: "FINISHED" });
      if (String(url).endsWith("/media_publish")) return Response.json({ id: "ig-post-123" });
      throw new Error("unexpected request");
    };
    const result = await instagramAdapter.publishPhoto({ token: "test", pageId: "123", content: "hello", mediaUrl: "https://example.test/image.jpg" });
    assert.equal(result.providerPostId, "ig-post-123");
    assert.equal(requests[0].init.body.get("image_url"), "https://example.test/image.jpg");
    assert.equal(requests[2].init.body.get("creation_id"), "container-123");
  } finally { globalThis.fetch = original; }
});

test("Instagram refreshes a long-lived token without sending a media publish request", async () => {
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: new URL(String(url)), init });
      return Response.json({ access_token: "refreshed-test-token", expires_in: 3600 });
    };
    const result = await instagramAdapter.refreshToken("old-test-token");
    assert.equal(result.token, "refreshed-test-token");
    assert.ok(result.expiresAt.getTime() > Date.now());
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.pathname, "/refresh_access_token");
    assert.equal(requests[0].url.searchParams.get("grant_type"), "ig_refresh_token");
    assert.equal(requests[0].init.method, "GET");
    assert.ok(!requests.some(({ url }) => url.pathname.endsWith("/media_publish")));
  } finally { globalThis.fetch = original; }
});

test("Instagram permission errors stop before publishing and do not expose provider details", async () => {
  const original = globalThis.fetch;
  const paths = [];
  try {
    globalThis.fetch = async (url) => {
      paths.push(new URL(String(url)).pathname);
      return Response.json({ error: { message: "private-provider-detail", code: 200 } }, { status: 403 });
    };
    await assert.rejects(instagramAdapter.publishPhoto({
      token: "test", pageId: "123", content: "test", mediaUrl: "https://example.test/image.jpg",
    }), error => error.message === "Instagram API rejected request (403).");
    assert.deepEqual(paths, ["/v26.0/123/media"]);
    await assert.rejects(instagramAdapter.refreshToken("test"), /Instagram API rejected request \(403\)/);
    assert.ok(!paths.some(path => path.endsWith("/media_publish")));
  } finally { globalThis.fetch = original; }
});

test("Instagram container failure does not publish or invent a provider ID", async () => {
  const original = globalThis.fetch;
  const paths = [];
  try {
    globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.endsWith("/media")) return Response.json({ id: "test-container" });
      if (path.endsWith("/test-container")) return Response.json({ status_code: "ERROR" });
      throw new Error("Unexpected publish request");
    };
    await assert.rejects(instagramAdapter.publishPhoto({
      token: "test", pageId: "123", content: "test", mediaUrl: "https://example.test/image.jpg",
    }), /media was not ready/);
    assert.deepEqual(paths, ["/v26.0/123/media", "/v26.0/test-container"]);
  } finally { globalThis.fetch = original; }
});

test("Instagram missing publish ID remains uncertain rather than reporting success", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/media")) return Response.json({ id: "test-container" });
      if (path.endsWith("/test-container")) return Response.json({ status_code: "FINISHED" });
      if (path.endsWith("/media_publish")) return Response.json({});
      throw new Error("Unexpected provider request");
    };
    await assert.rejects(instagramAdapter.publishPhoto({
      token: "test", pageId: "123", content: "test", mediaUrl: "https://example.test/image.jpg",
    }), /publish outcome is uncertain/);
  } finally { globalThis.fetch = original; }
});

test("TikTok demands image and current creator privacy options, returning a pending publish ID", async () => {
  await assert.rejects(tiktokAdapter.publishPhoto({ token: "test", content: "hello", privacyLevel: "SELF_ONLY" }), /image/);
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("creator_info")) return Response.json({ data: { creator_nickname: "Test creator", privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
      if (String(url).includes("content/init")) return Response.json({ data: { publish_id: "pending-123" }, error: { code: "ok" } });
      throw new Error("unexpected request");
    };
    const input = { token: "test", content: "hello", mediaUrl: "https://example.test/image.jpg", privacyLevel: "SELF_ONLY" };
    await assert.rejects(tiktokAdapter.publishPhoto({ ...input, privacyLevel: "PUBLIC_TO_EVERYONE" }), /not available/);
    assert.equal((await tiktokAdapter.publishPhoto(input)).providerPostId, "pending-123");
    assert.equal(JSON.parse(requests.at(-1).init.body).post_info.privacy_level, "SELF_ONLY");
  } finally { globalThis.fetch = original; }
});

test("TikTok OAuth state is bound to the initiating browser and grants publishing permission", async () => {
  const old = process.env.SESSION_SECRET;
  const original = globalThis.fetch;
  try {
    process.env.SESSION_SECRET = "test-secret";
    const res = { cookie(name, value, options) { this.cookieValue = value; this.name = name; assert.equal(options.httpOnly, true); }, clearCookie() {} };
    const state = beginTikTokLogin(res, "restaurant");
    assert.deepEqual(consumeTikTokLogin({ cookies: { [res.name]: res.cookieValue }, query: { state } }, res), { restaurantId: "restaurant" });
    assert.equal(consumeTikTokLogin({ cookies: { [res.name]: res.cookieValue }, query: { state: "wrong" } }, res), null);
    const brandState = beginTikTokLogin(res, null);
    assert.deepEqual(consumeTikTokLogin({ cookies: { [res.name]: res.cookieValue }, query: { state: brandState } }, res), { restaurantId: null });
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/oauth/token/")) return Response.json({ access_token: "access", refresh_token: "refresh", open_id: "user", expires_in: 7200, scope: "user.info.basic,video.publish" });
      if (String(url).includes("/user/info/")) return Response.json({ data: { user: { open_id: "user", display_name: "Test" } }, error: { code: "ok" } });
      throw new Error("unexpected request");
    };
    const account = await exchangeTikTokCode("code", { clientKey: "key", clientSecret: "secret", redirectUri: "https://example.test/admin/social/tiktok/callback" });
    assert.equal(account.userId, "user");
    assert.equal(account.refreshToken, "refresh");
  } finally {
    globalThis.fetch = original;
    if (old === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = old;
  }
});