import assert from "node:assert/strict";
import { test } from "node:test";
import { beginInstagramLogin, consumeInstagramLogin, exchangeInstagramCode, instagramConfig } from "./instagram.oauth.ts";

function response() {
  const cookies = [];
  return {
    cookies,
    cookie(name, value, options) { cookies.push({ name, value, options }); },
    clearCookie(name, options) { cookies.push({ name, options }); },
  };
}

test("Instagram state is browser-bound, signed, cleared at the callback, and scope-bound", () => {
  const started = response();
  const state = beginInstagramLogin(started, "restaurant-place-id");
  const saved = started.cookies[0];
  assert.equal(saved.options.httpOnly, true);
  assert.equal(saved.options.secure, true);
  assert.equal(saved.options.sameSite, "lax");
  const callback = response();
  const req = { cookies: { [saved.name]: saved.value }, query: { state } };
  assert.equal(consumeInstagramLogin(req, callback)?.restaurantId, "restaurant-place-id");
  assert.equal(callback.cookies[0].value, undefined);
  assert.equal(consumeInstagramLogin({ cookies: {}, query: { state } }, response()), null);
  assert.equal(consumeInstagramLogin({ ...req, query: { state: "different" } }, response()), null);
  const [payload, signature] = saved.value.split(".");
  const modified = Buffer.from(JSON.stringify({ nonce: state, restaurantId: null, expiresAt: Date.now() + 600_000 })).toString("base64url");
  assert.equal(consumeInstagramLogin({ cookies: { [saved.name]: `${modified}.${signature}` }, query: { state } }, response()), null);
  assert.notEqual(payload, modified);
});

test("Instagram configuration rejects non-HTTPS and wrong callback paths", () => {
  const before = {
    INSTAGRAM_APP_ID: process.env.INSTAGRAM_APP_ID,
    INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET,
    INSTAGRAM_REDIRECT_URI: process.env.INSTAGRAM_REDIRECT_URI,
  };
  try {
    process.env.INSTAGRAM_APP_ID = "123";
    process.env.INSTAGRAM_APP_SECRET = "test-secret-not-for-production";
    process.env.INSTAGRAM_REDIRECT_URI = "http://example.test/admin/social/instagram/callback";
    assert.equal(instagramConfig(), null);
    process.env.INSTAGRAM_REDIRECT_URI = "https://example.test/wrong/callback";
    assert.equal(instagramConfig(), null);
    process.env.INSTAGRAM_REDIRECT_URI = "https://example.test/admin/social/instagram/callback";
    assert.equal(instagramConfig()?.appId, "123");
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Instagram Login accepts documented token envelopes and verifies professional profile", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const dataEnvelope of [true, false]) {
      const requests = [];
      globalThis.fetch = async (url, init) => {
        requests.push({ url: String(url), init });
        if (String(url) === "https://api.instagram.com/oauth/access_token") {
          const token = { access_token: "short-token", permissions: "instagram_business_basic" };
          return Response.json(dataEnvelope ? { data: [token] } : token);
        }
        if (String(url).startsWith("https://graph.instagram.com/access_token?")) {
          return Response.json({ access_token: "long-token", expires_in: 5000000 });
        }
        if (String(url).startsWith("https://graph.instagram.com/me?")) {
          return Response.json({ user_id: "123456", username: "foodadvisor", account_type: "BUSINESS" });
        }
        throw new Error("Unexpected provider request");
      };
      const result = await exchangeInstagramCode("one-use-code", {
        appId: "123", appSecret: "test-only-secret",
        redirectUri: "https://example.test/admin/social/instagram/callback",
      });
      assert.equal(result.userId, "123456");
      assert.equal(result.username, "foodadvisor");
      assert.equal(result.token, "long-token");
      assert.ok(result.expiresAt > new Date());
      assert.equal(requests.length, 3);
      assert.equal(requests[0].init.body.get("redirect_uri"), "https://example.test/admin/social/instagram/callback");
      assert.equal(requests[2].init.headers.Authorization, "Bearer long-token");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});