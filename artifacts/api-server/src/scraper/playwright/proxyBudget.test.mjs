import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [path.join(directory, "proxyBudget.ts")],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{
    name: "forbid-live-database",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "forbidden", namespace: "offline" }));
      builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
        contents: 'throw new Error("Live database access forbidden in offline tests"); export const pool = null;',
      }));
    },
  }],
});
const { readBudgetPolicy, reserveProxyBudget } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const proxy = { server: "http://brd.superproxy.io:33335", host: "http://brd.superproxy.io:33335" };
const now = Date.parse("2026-09-23T12:00:00Z");
const pricing = {
  provider: "brightdata", currency: "USD", usdMicrosPerGB: 8_000_000,
  sessionCeilingMicros: 200_000, verifiedAt: "2026-09-23T00:00:00Z",
  validUntil: "2026-09-24T00:00:00Z", ceilingEvidence: "offline-fixture-contract",
};
function env(overrides = {}) {
  return {
    SCRAPER_PROXY_BUDGET_USD_MICROS: "1000000",
    SCRAPER_PROXY_PRICING_JSON: JSON.stringify({ maps: { ...pricing, ...overrides }, website: pricing }),
  };
}

test("pricing is mandatory, current, provider-bound, integer USD and sufficient for byte allowance", () => {
  assert.equal(readBudgetPolicy("maps", proxy, env(), now).cap, 1_000_000);
  for (const overrides of [
    { currency: "GBP" }, { provider: "unknown" }, { usdMicrosPerGB: 0 },
    { usdMicrosPerGB: 1.1 }, { sessionCeilingMicros: 100 },
    { sessionCeilingMicros: 2_000_000 }, { ceilingEvidence: "" },
    { verifiedAt: "2026-10-01" }, { validUntil: "2026-09-22" },
    { validUntil: "2027-01-01" }, { validUntil: "invalid" },
  ]) assert.throws(() => readBudgetPolicy("maps", proxy, env(overrides), now), /verified/);
  assert.throws(() => readBudgetPolicy("maps", proxy, {}, now), /verified/);
  assert.throws(() => readBudgetPolicy("maps", { server: "http://evil.org" }, env(), now), /verified/);
});

test("database failures and ambiguous commits fail closed, without leaking provider or database errors", async () => {
  for (const failAt of ["connect", "UPDATE", "INSERT INTO scraper_proxy_reservations", "COMMIT"]) {
    let released = false;
    const pool = {
      async connect() {
        if (failAt === "connect") throw Error("sensitive fixture");
        return {
          async query(sql) {
            if (sql.includes(failAt)) throw Error("sensitive fixture");
            return { rows: [{}], rowCount: 1 };
          },
          release() { released = true; },
        };
      },
    };
    await assert.rejects(reserveProxyBudget("maps", proxy, { pool, env: env(), now }),
      { message: "Proxy budget unavailable or exhausted; browser scan blocked." });
    assert.equal(released, failAt !== "connect");
  }
});

test("real offline PostgreSQL serializes concurrent reservations and retains lifetime usage", async () => {
  // Isolated Unix-socket database; never consult environment connection strings.
  const temp = mkdtempSync(path.join(tmpdir(), "proxy-budget-"));
  const data = path.join(temp, "data");
  const require = createRequire(new URL("../../../../../lib/db/package.json", import.meta.url));
  const { Pool } = require("pg");
  let started = false;
  let pool;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "offline"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", path.join(temp, "log"), "-o", `-h '' -k '${temp}' -p 55439`, "-w", "start"], { stdio: "pipe" });
    started = true;
    pool = new Pool({ host: temp, port: 55439, user: "offline", database: "postgres", max: 20 });
    const migration = readFileSync(new URL("../../../../../lib/db/migrations/0006_scraper_proxy_budget.sql", import.meta.url), "utf8");
    await assert.rejects(reserveProxyBudget("maps", proxy, { pool, env: env(), now }), /blocked/);
    await pool.query(migration);
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      reserveProxyBudget(i % 2 ? "maps" : "website", proxy, { pool, env: env(), now })));
    assert.equal(attempts.filter(r => r.status === "fulfilled").length, 5);
    assert.equal(attempts.filter(r => r.status === "rejected").length, 15);
    const balance = await pool.query("SELECT * FROM scraper_proxy_budget");
    assert.equal(Number(balance.rows[0].reserved_micros), 1_000_000);
    assert.equal((await pool.query("SELECT * FROM scraper_proxy_reservations")).rowCount, 5);
    // A different process configuration cannot silently raise the cap.
    await assert.rejects(reserveProxyBudget("maps", proxy, {
      pool, env: { ...env(), SCRAPER_PROXY_BUDGET_USD_MICROS: "2000000" }, now,
    }), /blocked/);
    await pool.end();
    pool = new Pool({ host: temp, port: 55439, user: "offline", database: "postgres" });
    await assert.rejects(reserveProxyBudget("website", proxy, { pool, env: env(), now }), /blocked/);
  } finally {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(temp, { recursive: true, force: true });
  }
});