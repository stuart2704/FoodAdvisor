import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { createServer } from "vite";

// Mount the actual unauthenticated API route without starting the full API
// service or connecting to a database. Vite proxies the browser's same-origin
// /auth/session request to it, as the artifact router does in the app.
const apiRequire = createRequire(new URL("../../api-server/package.json", import.meta.url));
const express = apiRequire("express");
const session = apiRequire("express-session");
const { default: authRoutes } = await import("../../api-server/src/routes/auth.ts");
const api = express();
const sessionRequests = [];
api.use(session({
  secret: randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
}));
api.use("/auth", (req, _res, next) => {
  sessionRequests.push({
    path: req.path,
    method: req.method,
    authorization: req.headers.authorization,
    cookie: req.headers.cookie,
  });
  next();
}, authRoutes);

const apiServer = await new Promise(resolve => {
  const listener = api.listen(0, "127.0.0.1", () => resolve(listener));
});
let web;
let browser;

try {
  web = await createServer({
    configFile: new URL("../vite.config.ts", import.meta.url).pathname,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: { "/auth": `http://127.0.0.1:${apiServer.address().port}` },
    },
  });
  await web.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const origin = `http://127.0.0.1:${web.httpServer.address().port}`;
    const errors = [];
    const unexpectedRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      // Font and Clerk CDN requests are not needed to check the local login
      // form. Keep the smoke test offline and independent of those providers.
      if (url.origin !== origin) return route.abort();
      if (request.method() !== "GET" || (
        url.pathname.startsWith("/auth/") && url.pathname !== "/auth/session"
      )) {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });

    for (const path of ["/admin", "/admin/login"]) {
      const before = sessionRequests.length;
      const sessionResponsePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === "/auth/session" && response.request().method() === "GET"
      );
      await page.goto(`${origin}${path}`);
      await page.waitForURL(`${origin}/admin/login`);
      await page.getByRole("heading", { name: "Admin Login" }).waitFor();
      const email = page.getByRole("textbox", { name: "Email" });
      const password = page.getByLabel("Password", { exact: true });
      await email.waitFor();
      await password.waitFor();
      assert.equal(await email.getAttribute("type"), "email");
      assert.equal(await password.getAttribute("type"), "password");
      assert.equal(await email.getAttribute("required"), "");
      assert.equal(await password.getAttribute("required"), "");
      await page.getByRole("button", { name: "Sign In" }).waitFor();
      const sessionResponse = await sessionResponsePromise;
      assert.ok(sessionRequests.length > before, `${path} did not request the session endpoint`);
      for (const request of sessionRequests.slice(before)) {
        assert.deepEqual(request, {
          path: "/session", method: "GET", authorization: undefined, cookie: undefined,
        }, `${path} must check the session without credentials`);
      }
      assert.equal(sessionResponse.status(), 200);
      assert.deepEqual(await sessionResponse.json(), { authenticated: false });
      assert.equal(page.url(), `${origin}/admin/login`);
    }

    assert.deepEqual(unexpectedRequests, [], "Unexpected network requests");
    assert.deepEqual(errors, [], "Browser errors");
    console.log("Unauthenticated admin login smoke passed");
  } finally {
    await context.close();
  }
} finally {
  await browser?.close();
  await web?.close();
  await new Promise((resolve, reject) => apiServer.close(error => error ? reject(error) : resolve()));
}