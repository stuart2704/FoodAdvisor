import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
const tempDir = await mkdtemp(path.join(apiRoot, ".dev-engine-test-"));
const noopRouter = `import { Router } from "express"; export default Router();`;
const mocks = {
  "routes/auth": `import { Router } from "express";
    const router = Router();
    router.post("/test-login", (req, res) => { req.session.admin = true; res.sendStatus(204); });
    export default router;`,
  "routes/ai": `import { Router } from "express";
    export const aiAutomationRouter = Router(); export default Router();`,
  "modules/social": noopRouter,
  "outreach/instantlyWebhook": `import { Router } from "express";
    export const instantlyWebhookRouter = Router();`,
  "services/stripeService": `export class StripeWebhookSignatureError extends Error {}
    export async function handleWebhook() { throw new Error("Not used in this test"); }`,
  "middlewares/clerkProxyMiddleware": `export const CLERK_PROXY_PATH = "/clerk-proxy";
    export const getClerkProxyHost = () => null;
    export const clerkProxyMiddleware = () => (_req, _res, next) => next();`,
  "lib/logger": `export const logger = { info() {}, error() {} };`,
  "automation/loopRunner": `export async function runEngineCycle() { globalThis.__devEngineCycles++; }`,
  "@clerk/express": `export const clerkMiddleware = () => (_req, _res, next) => next();`,
  "@clerk/shared/keys": `export const publishableKeyFromHost = () => "test";`,
  "pino-http": `export default () => (req, _res, next) => {
    req.log = { error() {} }; next();
  };`,
};

async function bundle(entry, outfile, replacements) {
  await build({
    entryPoints: [path.join(apiRoot, "src", entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
    plugins: [{
      name: "isolate-external-work",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === "express" && args.namespace !== "file") {
            return { path: "express", external: true };
          }
          const resolved = args.path.startsWith(".")
            ? path.resolve(args.resolveDir, args.path)
            : args.path;
          const key = Object.keys(replacements).find((candidate) =>
            resolved === candidate || resolved.endsWith(`/${candidate}`));
          if (key) return { path: key, namespace: "test-mock" };
          if (entry === "app.ts" &&
              args.importer.endsWith("/src/app.ts") &&
              (args.path === "./routes" || args.path.startsWith("./routes/")) &&
              args.path !== "./routes/devEngineRunner") {
            return { path: args.path, namespace: "empty-route" };
          }
        });
        builder.onLoad({ filter: /.*/, namespace: "test-mock" }, (args) => ({
          contents: replacements[args.path],
          loader: "js",
        }));
        builder.onLoad({ filter: /.*/, namespace: "empty-route" }, () => ({
          contents: noopRouter,
          loader: "js",
        }));
      },
    }],
  });
}

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, url, cookie, secure = false) {
  return fetch(`${base}${url}`, {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(secure ? { "x-forwarded-proto": "https" } : {}),
    },
  });
}

test("development engine control is production-disabled and requires an admin session", async () => {
  const oldEnvironment = process.env.NODE_ENV;
  const oldSecret = process.env.SESSION_SECRET;
  const outfile = path.join(tempDir, "app.mjs");
  try {
    await bundle("app.ts", outfile, mocks);
    process.env.SESSION_SECRET = "development-engine-test-secret-at-least-32-characters";
    globalThis.__devEngineCycles = 0;

    process.env.NODE_ENV = "development";
    const developmentApp = (await import(`${pathToFileURL(outfile).href}?dev`)).default;
    await withServer(developmentApp, async (base) => {
      const anonymous = await post(base, "/dev/run-engines");
      assert.equal(anonymous.status, 401);
      assert.equal(globalThis.__devEngineCycles, 0);

      const login = await post(base, "/auth/test-login");
      assert.equal(login.status, 204);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie, "admin login should issue a session cookie");

      const authorized = await post(base, "/dev/run-engines", cookie);
      assert.equal(authorized.status, 200);
      assert.deepEqual(await authorized.json(), {
        status: "ok",
        message: "Engine cycle executed.",
      });
      assert.equal(globalThis.__devEngineCycles, 1, "one request runs one cycle");
    });

    process.env.NODE_ENV = "production";
    const productionApp = (await import(`${pathToFileURL(outfile).href}?prod`)).default;
    await withServer(productionApp, async (base) => {
      const anonymous = await post(base, "/dev/run-engines");
      assert.equal(anonymous.status, 403);
      assert.equal(globalThis.__devEngineCycles, 1);

      const login = await post(base, "/auth/test-login", undefined, true);
      assert.equal(login.status, 204);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie, "production admin login should issue a secure session cookie");
      const authorized = await post(base, "/dev/run-engines", cookie, true);
      assert.equal(authorized.status, 403);
      assert.equal(globalThis.__devEngineCycles, 1, "production must not run any cycle");
    });
  } finally {
    if (oldEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnvironment;
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
    delete globalThis.__devEngineCycles;
  }
});

test("importing runEngineCycle does not start the continuous loop", async () => {
  const outfile = path.join(tempDir, "loop.mjs");
  await bundle("automation/loopRunner.ts", outfile, {
    "lib/logger": `export const logger = { info() {}, error() {} };`,
    "services/engineHeartbeat": `export async function recordHeartbeat() {}`,
    "automation/globalMetricsEngine": `export default async function updateGlobalMetrics() { return { id: 1 }; }`,
    "automation/outreachEngine": `export default async function outreachEngine() {
      throw new Error("Import unexpectedly started outreach");
    }`,
  });
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const module = await import(${JSON.stringify(pathToFileURL(outfile).href)});
    if (typeof module.runEngineCycle !== "function") process.exitCode = 1;
  `], { encoding: "utf8", timeout: 3000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || "import started the continuous loop");
});

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});