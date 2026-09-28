import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, devices } from "playwright";
import { createServer } from "vite";

// Bundle the real public route, profile projection and calendar serializer.
// Replace only persistence and unrelated server services; never reach the live DB.
const apiRoot = path.resolve(import.meta.dirname, "../../api-server");
const apiRequire = createRequire(path.join(apiRoot, "package.json"));
const { build } = apiRequire("esbuild");
const express = apiRequire("express");
const bundlePath = path.join(apiRoot, `.calendar-browser-${process.pid}.mjs`);
const fixtures = String.raw`
const table = (kind) => new Proxy({ kind }, {
  get(target, key) { return key === "kind" ? kind : { name: key }; },
});
export const restaurantsTable = table("restaurants");
export const restaurantOffersTable = table("offers");
export const restaurantEventsTable = table("events");
export const restaurantMenuItemsTable = table("menu");
export const restaurantChefProfilesTable = table("chef");
export const restaurantCollectionMembersTable = table("members");
export const restaurantCollectionsTable = table("collections");
export const placeAmenityChecksTable = table("amenityChecks");
export const restaurantProfileViewEventsTable = table("views");
function matches(condition, row) {
  if (condition.op === "and") return condition.conditions.every(part => matches(part, row));
  if (condition.op === "inArray") return false;
  const actual = row[condition.column.name];
  if (condition.op === "eq") return actual === condition.value;
  if (condition.op === "gte") return actual >= condition.value;
  if (condition.op === "lte") return actual <= condition.value;
  throw new Error("Unexpected query condition: " + condition.op);
}
export const db = {
  select(selection) {
    return {
      from(table) { this.table = table; return this; },
      innerJoin() { return this; },
      where(condition) { this.condition = condition; return this; },
      orderBy(...columns) { this.order = columns; return this; },
      limit(count) { this.count = count; return this; },
      then(resolve, reject) {
        try {
          let rows = globalThis.__calendarFixtures[this.table.kind].filter(row =>
            !this.condition || matches(this.condition, row));
          if (this.order) rows = rows.sort((a, b) => {
            for (const column of this.order) {
              const comparison = a[column.name] < b[column.name] ? -1 : a[column.name] > b[column.name] ? 1 : 0;
              if (comparison) return comparison;
            }
            return 0;
          });
          if (this.count) rows = rows.slice(0, this.count);
          resolve(rows.map(row => selection
            ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, row[column.name]]))
            : { ...row }));
        } catch (error) { reject(error); }
      },
    };
  },
  insert() { return { values: async () => {} }; },
};
`;
const conditions = `
export const and = (...conditions) => ({ op: "and", conditions });
export const asc = column => column;
export const eq = (column, value) => ({ op: "eq", column, value });
export const gte = (column, value) => ({ op: "gte", column, value });
export const lte = (column, value) => ({ op: "lte", column, value });
export const inArray = (column, value) => ({ op: "inArray", column, value });
export const isNotNull = column => ({ op: "notNull", column });
export const sql = () => "";
`;
const ancillary = new Map([
  ["middleware/adminOnly.ts", "export const adminOnly = (_req, _res, next) => next();"],
  ["services/analyticsEngine.ts", "export const logEvent = async () => {};"],
  ["services/rankingEngine.ts", "export const calculateRanking = () => 0;"],
  ["services/restaurantProfileCache.ts", 'export const profileCacheControl = () => "no-store";'],
  ["utils/locationAliases.ts", "export const preserveVanishedLocation = async () => {};"],
  ["utils/slugify.ts", "export const restaurantSlug = () => 'unused';"],
  ["lib/cache.ts", "export const cache = { del() {} };"],
]);
const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const restaurant = (placeId, extra = {}) => ({
  placeId, name: "Calendar Bistro", published: true, claimedAt: new Date("2025-01-01T00:00:00Z"),
  claimStatus: "verified", sourceName: "OSM", sourceAttribution: null, city: "London",
  country: "UK", cuisineTags: [], types: [], openingHours: [], currency: "GBP",
  popularity: 0, premium: false, rating: null, address: "1 Test Street", ...extra,
});
globalThis.__calendarFixtures = {
  restaurants: [
    restaurant("osm:calendar-main"),
    restaurant("osm:calendar-other", { name: "Other Bistro" }),
    restaurant("osm:calendar-hidden", { published: false }),
    restaurant("osm:calendar-unclaimed", { claimedAt: null }),
  ],
  events: [
    { id: 101, restaurantId: "osm:calendar-main", title: "Jazz Night", description: "Live music", eventDate: day(2), eventTime: "19:30", price: "Free" },
    { id: 102, restaurantId: "osm:calendar-main", title: "Past Show", description: "Over", eventDate: day(-2), eventTime: "19:30", price: "Free" },
    { id: 103, restaurantId: "osm:calendar-other", title: "Other Show", description: "Elsewhere", eventDate: day(2), eventTime: "19:30", price: "Free" },
    { id: 104, restaurantId: "osm:calendar-hidden", title: "Hidden Show", description: "Private", eventDate: day(2), eventTime: "19:30", price: "Free" },
    { id: 105, restaurantId: "osm:calendar-unclaimed", title: "Unclaimed Show", description: "Private", eventDate: day(2), eventTime: "19:30", price: "Free" },
  ],
  offers: [], menu: [], chef: [], members: [], collections: [], amenityChecks: [],
};

let apiServer, web, browser;
try {
  await build({
    entryPoints: [path.join(apiRoot, "src/routes/restaurant.ts")],
    outfile: bundlePath, bundle: true, platform: "node", format: "esm",
    packages: "external", logLevel: "silent",
    plugins: [{
      name: "calendar-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$/ }, args =>
          ({ path: args.path, namespace: "fixture" }));
        builder.onResolve({ filter: /^\./ }, args => {
          const resolved = path.resolve(args.resolveDir, args.path) + ".ts";
          if (ancillary.has(path.relative(path.join(apiRoot, "src"), resolved)))
            return { path: path.relative(path.join(apiRoot, "src"), resolved), namespace: "fixture" };
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
          contents: args.path === "@workspace/db" ? fixtures
            : args.path === "drizzle-orm" ? conditions : ancillary.get(args.path),
          loader: "js",
        }));
      },
    }],
  });
  const { default: routes } = await import(pathToFileURL(bundlePath).href);
  const api = express();
  api.use((req, _res, next) => {
    req.log = { error: () => {}, warn: () => {} };
    next();
  });
  api.use("/api", routes);
  apiServer = await new Promise(resolve => {
    const listener = api.listen(0, "127.0.0.1", () => resolve(listener));
  });
  web = await createServer({
    configFile: new URL("../vite.config.ts", import.meta.url).pathname,
    server: {
      host: "127.0.0.1", port: 0, strictPort: false,
      proxy: { "/api/restaurant": `http://127.0.0.1:${apiServer.address().port}` },
    },
  });
  await web.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox"],
  });
  const origin = `http://127.0.0.1:${web.httpServer.address().port}`;
  for (const [profile, options] of [
    ["desktop", { viewport: { width: 1440, height: 900 } }],
    ["mobile", devices["iPhone 13"]],
  ]) {
    const context = await browser.newContext({ ...options, acceptDownloads: true, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/restaurant/"))
          return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        return route.continue();
      });
      await page.goto(`${origin}/restaurant/osm%3Acalendar-main`);
      const link = page.getByRole("link", { name: "Add Jazz Night to calendar" });
      await link.waitFor();
      const expectedPath = "/api/restaurant/osm%3Acalendar-main/events/101/calendar";
      assert.equal(new URL(await link.getAttribute("href"), origin).pathname, expectedPath);
      assert.equal(await page.getByRole("link", { name: /Add Past Show to calendar/ }).count(), 0);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        link.click(),
      ]);
      assert.equal(new URL(download.url()).pathname, expectedPath);
      assert.equal(download.suggestedFilename(), "restaurant-event-101.ics");
      assert.equal(await download.failure(), null);
      // Chromium emits a download instead of a page response for attachments.
      // Request the same link in this browser context to inspect HTTP headers.
      const attachment = await context.request.get(`${origin}${expectedPath}`);
      assert.equal(attachment.status(), 200);
      assert.match(attachment.headers()["content-type"], /^text\/calendar;\s*charset=utf-8/i);
      assert.equal(attachment.headers()["content-disposition"], 'attachment; filename="restaurant-event-101.ics"');
      assert.equal(attachment.headers()["cache-control"], "no-store");
      const ics = await readFile(await download.path(), "utf8");
      assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
      assert.match(ics, new RegExp(`DTSTART:${day(2).replaceAll("-", "")}T193000\\r\\n`));
      assert.match(ics, /SUMMARY:Jazz Night — Calendar Bistro\r\n/);
      assert.match(ics, /\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n$/);
      assert.deepEqual(errors, [], `Browser errors on ${profile}`);

      // Check the public endpoint through this browser profile, not just the
      // serializer. A 404 must not masquerade as an HTML or calendar download.
      for (const [id, eventId] of [
        ["osm:calendar-main", 999], // missing
        ["osm:calendar-main", 102], // expired
        ["osm:calendar-main", 103], // belongs to another restaurant
        ["osm:calendar-hidden", 104], // unpublished
        ["osm:calendar-unclaimed", 105], // not verified
      ]) {
        const denied = await context.request.get(`${origin}/api/restaurant/${encodeURIComponent(id)}/events/${eventId}/calendar`);
        assert.equal(denied.status(), 404, `${profile}: ${id}/${eventId}`);
        assert.match(denied.headers()["content-type"], /^application\/json/);
        assert.equal(denied.headers()["content-disposition"], undefined);
        assert.deepEqual(await denied.json(), { success: false, error: "Event not found." });
      }
      console.log(`Calendar download and denied links passed on ${profile}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await web?.close();
  if (apiServer) await new Promise((resolve, reject) =>
    apiServer.close(error => error ? reject(error) : resolve()));
  await rm(bundlePath, { force: true });
}