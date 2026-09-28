import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

// Deliberately start the real web app, but never allow a browser request to reach
// a real admin API, an OAuth provider, or a social publishing endpoint.
const server = await createServer({
  configFile: new URL("../vite.config.ts", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
let browser;

const fixtures = new Map([
  ["/auth/session", { authenticated: true }],
  ["/admin/social/health", {
    health: { state: "disabled", workerConfigured: false, lastHeartbeatAt: null, lastSuccessAt: null, lastFailureAt: null },
    periodDays: 30,
    metrics: {
      generation: { succeeded: 0, failed: 0, averageMs: null },
      scheduling: { succeeded: 0, failed: 0, averageMs: null },
      publishing: { succeeded: 0, failed: 0, averageMs: null, attempts: 0, pending: 0, uncertain: 0, completed: 0, successRate: null },
    },
  }],
  ["/admin/social/accounts", { accounts: [] }],
  ["/admin/social/instagram/config", { configured: false, redirectUri: null }],
  ["/admin/social/facebook/config", { configured: false, redirectUri: null }],
  ["/admin/social/tiktok/config", { configured: false, redirectUri: null }],
  ["/dashboard/operations/queue", {
    checkedAt: "2026-01-01T00:00:00.000Z",
    queue: { pending: 0, capacity: 10, draining: false, items: [] },
  }],
]);

async function visibleOutsideSidebar(page, selector) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  const sidebar = await page.locator(".admin-layout > .admin-sidebar").boundingBox();
  const content = await page.locator(".admin-layout > .admin-content").boundingBox();
  assert.ok(bounds && sidebar && content, `Missing layout geometry for ${selector}`);
  assert.ok(bounds.width > 0 && bounds.height > 0, `${selector} has no visible area`);
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1,
    `${selector} is outside the viewport horizontally`);
  assert.ok(
    content.x >= sidebar.x + sidebar.width - 1 || content.y >= sidebar.y + sidebar.height - 1,
    "Admin content overlaps the sidebar",
  );
  assert.ok(bounds.x >= content.x - 1 && bounds.y >= content.y - 1, `${selector} is outside admin content`);
  const hit = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top === element || element.contains(top);
  });
  assert.ok(hit, `${selector} is covered by another element`);
}

async function run(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const requests = [];
    const unexpectedRequests = [];
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (fixtures.has(url.pathname)) {
        requests.push(`${request.method()} ${url.pathname}`);
        if (request.method() !== "GET") {
          unexpectedRequests.push(`${request.method()} ${url.pathname}`);
          return route.abort();
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixtures.get(url.pathname)) });
      }
      if (/^\/(?:admin\/social|dashboard\/|auth\/)/.test(url.pathname) || request.method() !== "GET") {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));

    await page.goto(`${origin}/admin/automation/social?tab=accounts`);
    const content = page.locator(".admin-content");
    await content.getByRole("heading", { name: "Connected Accounts" }).waitFor();
    await content.getByText("No accounts connected yet.").waitFor();
    await visibleOutsideSidebar(page, ".admin-content .social-card:last-child h2");
    await visibleOutsideSidebar(page, ".admin-content .social-tabs");

    const dashboard = content.getByRole("navigation", { name: "Social Media sections" }).getByRole("button", { name: "Dashboard" });
    await dashboard.click({ force: false });
    await content.getByRole("heading", { name: "Publishing health" }).waitFor();
    await visibleOutsideSidebar(page, ".admin-content .social-dashboard .social-card:first-child h2");
    const accounts = content.getByRole("navigation", { name: "Social Media sections" }).getByRole("button", { name: "Accounts" });
    await accounts.click({ force: false });
    await content.getByRole("heading", { name: "Connected Accounts" }).waitFor();
    assert.match(page.url(), /tab=accounts/);

    await page.locator('nav[aria-label="System administration"]').getByRole("link", { name: "Queue" }).click();
    await content.getByRole("heading", { name: "Queue" }).waitFor();
    await content.getByText("No jobs are currently waiting.").waitFor();
    await visibleOutsideSidebar(page, ".admin-content .ops-header h1");
    await visibleOutsideSidebar(page, ".admin-content .ops-empty");
    assert.ok(requests.includes("GET /auth/session") && requests.includes("GET /dashboard/operations/queue"));
    assert.deepEqual(unexpectedRequests, [], `Unmocked or unsafe requests at ${width}px`);
    assert.deepEqual(errors, [], `Browser errors at ${width}px`);
    console.log(`Admin browser smoke passed at ${width}px`);
  } finally {
    await context.close();
  }
}

try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox"],
  });
  for (const width of [1440, 390]) await run(width);
} finally {
  await browser?.close();
  await server.close();
}