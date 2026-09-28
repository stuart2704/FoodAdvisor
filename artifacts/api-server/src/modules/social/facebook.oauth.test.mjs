import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginFacebookLogin, consumeFacebookLogin, savePendingPages, pendingPages,
  facebookAuthorizationUrl, facebookConfig, exchangeFacebookCode, fetchFacebookPages,
  fetchFacebookPagesWithSummary,
} from "./facebook.oauth.ts";

function response() {
  const cookies = [];
  return {
    cookies,
    cookie(name, value, options) { cookies.push({ name, value, options }); },
    clearCookie(name, options) { cookies.push({ name, options }); },
  };
}

test("Facebook login is signed, browser-bound, scoped, and single use at callback", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-with-sufficient-length";
  try {
    const started = response();
    const state = beginFacebookLogin(started, "restaurant-id");
    const saved = started.cookies[0];
    assert.equal(saved.options.httpOnly, true);
    assert.equal(saved.options.secure, true);
    assert.equal(saved.options.sameSite, "lax");
    assert.equal(consumeFacebookLogin({ cookies: { [saved.name]: saved.value }, query: { state } }, response()), "restaurant-id");
    assert.equal(consumeFacebookLogin({ cookies: {}, query: { state } }, response()), undefined);
    assert.equal(consumeFacebookLogin({ cookies: { [saved.name]: saved.value }, query: { state: "wrong" } }, response()), undefined);
    const tampered = saved.value.replace(/^./, saved.value[0] === "a" ? "b" : "a");
    assert.equal(consumeFacebookLogin({ cookies: { [saved.name]: tampered }, query: { state } }, response()), undefined);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("pending Page selection is encrypted, scoped, and expires", () => {
  const previous = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = "test-only-encryption-key";
  try {
    const started = response();
    savePendingPages(started, "secret-user-token", null);
    const saved = started.cookies[0];
    assert.equal(saved.value.includes("secret-user-token"), false);
    assert.deepEqual(pendingPages({ cookies: { [saved.name]: saved.value } }), {
      userToken: "secret-user-token", restaurantId: null,
    });
    assert.equal(pendingPages({ cookies: { [saved.name]: `${saved.value}tampered` } }), null);
  } finally {
    if (previous === undefined) delete process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
    else process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = previous;
  }
});

test("Facebook config uses an HTTPS callback on the same host as Instagram by default", () => {
  const before = {
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
    FACEBOOK_REDIRECT_URI: process.env.FACEBOOK_REDIRECT_URI,
    INSTAGRAM_REDIRECT_URI: process.env.INSTAGRAM_REDIRECT_URI,
  };
  try {
    process.env.FACEBOOK_APP_ID = "123";
    process.env.FACEBOOK_APP_SECRET = "test-secret";
    delete process.env.FACEBOOK_REDIRECT_URI;
    process.env.INSTAGRAM_REDIRECT_URI = "https://example.test/admin/social/instagram/callback";
    assert.equal(facebookConfig()?.redirectUri, "https://example.test/admin/social/facebook/callback");
    process.env.FACEBOOK_REDIRECT_URI = "http://example.test/admin/social/facebook/callback";
    assert.equal(facebookConfig(), null);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Business Login uses its configuration permissions instead of an additional scope parameter", () => {
  const config = { appId: "123", appSecret: "test-only", redirectUri: "https://example.test/admin/social/facebook/callback" };
  const businessUrl = new URL(facebookAuthorizationUrl(config, "signed-state", "business-config"));
  assert.equal(businessUrl.searchParams.get("config_id"), "business-config");
  assert.equal(businessUrl.searchParams.has("scope"), false);
  assert.equal(businessUrl.searchParams.get("response_type"), "code");
  assert.equal(businessUrl.searchParams.get("redirect_uri"), config.redirectUri);
  const regularUrl = new URL(facebookAuthorizationUrl(config, "signed-state"));
  assert.equal(regularUrl.searchParams.has("config_id"), false);
  assert.match(regularUrl.searchParams.get("scope"), /pages_show_list/);
});

test("Facebook exchanges a code for a long-lived user token and lists only publishable Pages", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return Response.json({ access_token: "short-token" });
      if (calls.length === 2) return Response.json({ access_token: "long-token" });
      return Response.json({ data: [
        { id: "123", name: "Page", access_token: "page-token", tasks: ["CREATE_CONTENT"] },
        { id: "456", name: "Read only", access_token: "other-token", tasks: ["ANALYZE"] },
      ] });
    };
    const token = await exchangeFacebookCode("code", {
      appId: "123", appSecret: "test-only", redirectUri: "https://example.test/admin/social/facebook/callback",
    });
    assert.equal(token, "long-token");
    assert.equal(new URL(calls[0].url).searchParams.get("redirect_uri"), "https://example.test/admin/social/facebook/callback");
    assert.equal(new URL(calls[1].url).searchParams.get("grant_type"), "fb_exchange_token");
    assert.deepEqual(await fetchFacebookPages(token), [{ id: "123", name: "Page", accessToken: "page-token" }]);
    assert.equal(calls[2].init.headers.Authorization, "Bearer long-token");
  } finally { globalThis.fetch = originalFetch; }
});

test("Page selection distinguishes no Pages, missing content task, and missing Page token", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [data, expected] of [
      [[], { returnedPageCount: 0, contentPageCount: 0, pages: [] }],
      [[{ id: "1", name: "Read only", access_token: "hidden", tasks: ["ANALYZE"] }],
        { returnedPageCount: 1, contentPageCount: 0, pages: [] }],
      [[{ id: "2", name: "Can post", tasks: ["CREATE_CONTENT"] }],
        { returnedPageCount: 1, contentPageCount: 1, pages: [] }],
    ]) {
      globalThis.fetch = async () => Response.json({ data });
      assert.deepEqual(await fetchFacebookPagesWithSummary("test-token"), expected);
    }
  } finally { globalThis.fetch = originalFetch; }
});