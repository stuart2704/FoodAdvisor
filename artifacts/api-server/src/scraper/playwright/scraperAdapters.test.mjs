import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
async function bundle(entry, mocks = {}) {
  const result = await build({
    stdin: { contents: entry, resolveDir: directory },
    bundle: true, write: false, platform: "node", format: "esm",
    plugins: [{
      name: "offline-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const key = Object.keys(mocks).find((suffix) => args.path.endsWith(suffix));
          return key ? { path: key, namespace: "fixture" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: mocks[args.path] }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const logMock = "export function logEvent(){} export function logError(){}";
const launcherMock = "export async function launchBrowser(){throw Error('Browser calls forbidden in this test');}";

test("proxy pools reject examples, missing config, embedded credentials and private IPs", async () => {
  const m = await bundle('export * from "./proxyService"', {
    "lib/public-url": "export function isPrivateAddress(ip){return ip.startsWith('127.') || ip.startsWith('10.');}",
  });
  for (const raw of [undefined, "[]", "{}", "invalid", '[{"host":"residential1.example.com:8000"}]',
    '[{"host":"127.0.0.1:8000"}]', '[{"host":"http://user:password@proxy.vendor.org:8000"}]',
    '[{"host":"proxy.vendor.org:8000","username":"user"}]']) {
    assert.throws(() => m.parseProxyPool(raw));
  }
  const pool = m.parseProxyPool('[{"host":"proxy.vendor.org:8000","username":"test-user","password":"fixture-password"}]');
  assert.equal(pool[0].server, "http://proxy.vendor.org:8000");
  assert.equal(pool[0].host, pool[0].server);
  assert.equal(pool[0].username, "test-user");
});

test("website extraction uses business mailboxes, exact social hosts and resolved same-origin menu links", async () => {
  const m = await bundle('export * from "./websiteScraper.playwright"', {
    "/playwrightClient": launcherMock, "dashboard/eventsFeed": logMock,
  });
  const data = m.extractWebsiteSignals(
    '<img srcset="a 1x"> Menu <style>font-family: serif</style> chef@bistro.org',
    "https://bistro.org/about/",
    ["mailto:info@bistro.org?subject=Hello", "../menu.pdf",
      "https://instagram.com.evil.org/name", "https://www.instagram.com/bistro",
      "https://facebook.com/bistro", "https://www.opentable.com/r/bistro",
      "https://opentable.com.evil.org/r/bistro", "javascript:alert(1)"],
  );
  assert.equal(data.email, "info@bistro.org");
  assert.equal(data.menuUrl, "https://bistro.org/menu.pdf");
  assert.equal(data.instagram, "https://www.instagram.com/bistro");
  assert.equal(data.facebook, "https://facebook.com/bistro");
  assert.equal(data.bookingUrl, "https://www.opentable.com/r/bistro");
  assert.equal(data.bookingProvider, "OpenTable");
  assert.equal(data.brandingQuality, "high");
  assert.equal(data.brandingAssessment, "heuristic");
  assert.equal(m.extractWebsiteSignals("chef@bistro.org", "https://bistro.org", []).email, null);
  assert.equal(m.scoreBranding("plain"), "low");
  await assert.rejects(() => m.scrapeWebsite("https://bistro.org"), /confirmation/);
});

test("Maps IDs never use CID values and browser scans require confirmation", async () => {
  const m = await bundle('export * from "./mapsScraper.playwright"', {
    "/playwrightClient": launcherMock, "dashboard/eventsFeed": logMock,
    "lib/restaurant-import": 'export const SUPPORTED_CITIES=["London"];',
  });
  assert.equal(m.placeIdFromMapsUrl("https://www.google.com/maps?query_place_id=ChIJabcdefghijk"), "ChIJabcdefghijk");
  assert.equal(m.placeIdFromMapsUrl("https://www.google.com/maps/place/x/data=!1sChIJabcdefghijk!2m2"), "ChIJabcdefghijk");
  assert.equal(m.placeIdFromMapsUrl("https://www.google.com/maps/place/x/data=!1s0x123:0x456"), undefined);
  assert.equal(m.placeIdFromMapsUrl("https://evil.org/?query_place_id=ChIJabcdefghijk"), undefined);
  await assert.rejects(() => m.scrapeMaps("London"), /confirmation/);
  await assert.rejects(() => m.scrapeMaps("Unsupported", { confirm: true }), /Unsupported/);
});

test("browser city staging keeps unresolved records out, deduplicates IDs and fetches shared websites once", async () => {
  const m = await bundle('export * from "./browserCityService";export {queued} from "../../pipeline/insertService";export {calls} from "./websiteScraper.playwright"', {
    "mapsScraper.playwright": `export async function scrapeMaps(){
      const base={name:"Test Bistro",address:"1 High Street",city:"London",mapsUrl:"https://www.google.com/maps",website:"https://bistro.org"};
      return [{...base,placeId:"ChIJabcdefghijk"},{...base,placeId:"ChIJabcdefghijk"},
        {...base,placeId:"ChIJsecondbranch"},{...base}];
    }`,
    "websiteScraper.playwright": 'export let calls=0;export async function scrapeWebsite(){calls++;return {email:"info@bistro.org",brandingQuality:"low",brandingAssessment:"heuristic"};}',
    "pipeline/insertService": "export const queued=[];export function queueForInsertion(r){queued.push(r);}",
    "utils/eventLog": logMock,
    "dashboard/eventsFeed": logMock,
  });
  const result = await m.scrapeBrowserCity("London", { confirm: true });
  assert.equal(result.persisted, false);
  assert.equal(result.queuedCount, 2);
  assert.equal(result.unresolved.length, 1);
  assert.equal(m.queued.length, 2);
  assert.equal(m.calls, 1);
});