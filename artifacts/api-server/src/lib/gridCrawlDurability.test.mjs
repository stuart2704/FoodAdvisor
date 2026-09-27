import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeGridPoint, reserveGridPoint, skipUncertainGridPoint, withGridCrawlLock,
} from "./gridCrawlRuntime.ts";

const point = { globalRegion: "Europe", city: "London" };
const allocation = { europe: { budget: 4, interval: 3, cities: { London: 4 } } };

function fixture(overrides = {}, regionUsed = 0, cityUsed = 0) {
  const state = { grid_hash: null, next_index: 0, pending_index: null,
    attempt_date: "2000-01-01", attempted_today: 0, automation_enabled: false,
    monthly_budget_cents: 3000, ...overrides };
  const calls = [];
  let locked = false;
  let snapshot;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === "BEGIN") { snapshot = { ...state }; return { rows: [] }; }
      if (sql === "ROLLBACK") { Object.assign(state, snapshot); return { rows: [] }; }
      if (sql === "COMMIT") return { rows: [] };
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: !locked }] };
      if (sql.includes("FROM crawler_progress") && sql.includes("FOR UPDATE")) {
        return { rows: [{ ...state }], rowCount: 1 };
      }
      if (sql.includes("count(*)") && sql.includes("restaurant_import_runs")) return { rows: [{ count: "0" }] };
      if (sql.includes("sum(estimated_cost_cents)")) return { rows: [{ spent: "0", calls: "0" }] };
      if (sql.includes("INSERT INTO region_progress")) {
        return { rows: [{ region_budget: 4, region_budget_used: regionUsed, next_region_run: null }] };
      }
      if (sql.includes("INSERT INTO city_progress")) return { rows: [{ city_budget: 4, city_budget_used: cityUsed }] };
      if (sql.includes("UPDATE crawler_progress SET next_index")) state.next_index = params[0];
      if (sql.includes("UPDATE crawler_progress SET grid_hash")) {
        Object.assign(state, { grid_hash: params[0], pending_index: params[1],
          attempt_date: params[2], attempted_today: params[3] });
      }
      if (sql.includes("UPDATE crawler_progress SET pending_index = NULL")) {
        Object.assign(state, { pending_index: null, next_index: params[0] });
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { state, calls, database: { connect: async () => client },
    setLocked: (value) => { locked = value; } };
}

function reserve(f, index = 0) {
  return reserveGridPoint("stable-grid", index, point, 1, 1, 1, allocation, 1000, false, false, f.database);
}

test("reservation commits cursor, UTC attempts and cost before request; restart cannot claim pending point", async () => {
  const f = fixture();
  assert.equal((await reserve(f)).status, "reserved");
  assert.deepEqual([f.state.grid_hash, f.state.next_index, f.state.pending_index, f.state.attempted_today],
    ["stable-grid", 0, 0, 1]);
  assert.ok(f.calls.findIndex(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")) <
    f.calls.findIndex(({ sql }) => sql.includes("SET grid_hash")));
  assert.equal(f.calls.at(-1).sql, "COMMIT");
  const charged = f.calls.filter(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")).length;
  await assert.rejects(reserve(f), /uncertain paid reservation/);
  assert.equal(f.calls.filter(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")).length, charged);
});

test("completion advances to terminal cursor, never wraps or enables automatic requests", async () => {
  const f = fixture();
  await reserve(f);
  await completeGridPoint("stable-grid", 0, point, 1, true, true, f.database);
  assert.deepEqual([f.state.next_index, f.state.pending_index], [1, null]);
  assert.match(f.calls.find(({ sql }) => sql.includes("cycle_completed = $2")).sql, /automation_enabled = FALSE/);
  await assert.rejects(reserve(f), /cursor changed/);
});

test("provider failure remains pending; deliberate skip retains charge and advances terminal cursor", async () => {
  const f = fixture();
  await reserve(f);
  await assert.rejects(completeGridPoint("wrong-grid", 0, point, 1, true, true, f.database), /Pending paid point changed/);
  assert.equal(f.state.pending_index, 0);
  assert.equal(await skipUncertainGridPoint("stable-grid", [point], f.database), 0);
  assert.equal(f.state.next_index, 1);
  assert.equal(f.calls.filter(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")).length, 1);
});

test("failed reservation rolls back all counters; competing run cannot acquire the lock", async () => {
  const f = fixture();
  f.setLocked(true);
  await assert.rejects(withGridCrawlLock(async () => reserve(f), f.database), /Another grid crawl/);
  assert.equal(f.calls.some(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")), false);
  f.setLocked(false);
  const broken = fixture({ grid_hash: "different" });
  await assert.rejects(reserve(broken), /Grid changed/);
  assert.equal(broken.state.pending_index, null);
  assert.equal(broken.calls.at(-1).sql, "ROLLBACK");
});

test("city and region exhaustion skip only to the next boundary, retaining a terminal cursor", async () => {
  for (const [regionUsed, cityUsed, expected, boundary] of [
    [0, 4, "city", 2], [4, 0, "region", 3],
  ]) {
    const f = fixture({ grid_hash: "stable-grid", monthly_budget_cents: 1000 }, regionUsed, cityUsed);
    const result = await reserveGridPoint("stable-grid", 0, point, 2, 3, 3,
      allocation, 1000, false, false, f.database);
    assert.equal(result.status, expected);
    assert.equal(f.state.next_index, boundary);
    assert.equal(f.calls.some(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")), false);
  }
});

test("UTC attempt limit and saved monthly cap stop without charging after restart", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const exhausted = fixture({ grid_hash: "stable-grid", monthly_budget_cents: 1000,
    attempt_date: today, attempted_today: 50 });
  assert.equal((await reserve(exhausted)).status, "daily");
  assert.equal(exhausted.calls.some(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")), false);
  const changedBudget = fixture({ grid_hash: "stable-grid", monthly_budget_cents: 500 });
  await assert.rejects(reserve(changedBudget), /saved limit/);
  assert.equal(changedBudget.calls.at(-1).sql, "ROLLBACK");
});