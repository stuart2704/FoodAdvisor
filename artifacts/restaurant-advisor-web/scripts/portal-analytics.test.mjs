import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bearer = "A".repeat(43); // Synthetic only. Never use an actual owner link in this test.

function open(url) {
  return new JSDOM(html, { url: `https://example.test${url}`, runScripts: "dangerously" });
}

test("legacy owner paths are removed before a tracker can inspect the page", () => {
  const page = open(`/portal/${bearer}/photos?session_id=synthetic#anything`);
  assert.equal(page.window.location.href, "https://example.test/portal/photos");
  assert.equal(page.window.sessionStorage.getItem("ownerPortalAccess"), bearer);
  assert.equal(page.window.document.querySelector('meta[name="referrer"]')?.content, "no-referrer");
  page.window.close();
});

test("fragment access links are scrubbed, then clean pages retain tab access", () => {
  const page = open(`/portal#access=${bearer}`);
  assert.equal(page.window.location.href, "https://example.test/portal");
  assert.equal(page.window.sessionStorage.getItem("ownerPortalAccess"), bearer);
  page.window.history.replaceState(null, "", "/portal/menu");
  page.window.eval(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "");
  assert.equal(page.window.location.pathname, "/portal/menu");
  assert.equal(page.window.sessionStorage.getItem("ownerPortalAccess"), bearer);
  page.window.close();
});

test("invalid legacy links never retain a previous owner token", () => {
  const page = open("/portal/invalid/analytics");
  assert.equal(page.window.location.pathname, "/portal/analytics");
  assert.equal(page.window.sessionStorage.getItem("ownerPortalAccess"), null);
  page.window.close();
});

test("invalid access fragments are removed without preserving access", () => {
  const page = open("/portal#access=invalid");
  assert.equal(page.window.location.href, "https://example.test/portal");
  assert.equal(page.window.sessionStorage.getItem("ownerPortalAccess"), null);
  page.window.close();
});