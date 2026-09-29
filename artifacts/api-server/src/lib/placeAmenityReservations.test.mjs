import assert from "node:assert/strict";
import { test } from "node:test";
import { completeAmenityDetails, reserveAmenityDetails, reserveRefreshAmenityDetails,
  completeRefreshAmenityDetails, reviewRefreshAmenityDetails } from "./placeAmenityReservations.ts";

const options = { monthlyBudgetCents: 3000, estimatedRequestCents: 80, dailyLimit: 10, providerMinuteQuota: 1, maxRequests: 5 };

function fakePool(responder) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return responder(sql, params);
    },
    release() { calls.push({ sql: "release" }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}

function responses(sql, { duplicate = false, latest, baseline = null, daily = 0, minute = 0, spent = 0, calls = 0 } = {}) {
  if (sql.includes("FROM crawler_progress")) return { rowCount: 1, rows: [{ monthly_budget_cents: 3000 }] };
  if (sql.includes("FROM place_amenity_checks WHERE place_id") && sql.includes("ORDER BY id DESC")) {
    const row = latest ?? (duplicate ? { status: "pending" } : null);
    return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
  }
  if (sql.includes("FROM restaurants")) return { rowCount: 1, rows: [{ amenities: baseline }] };
  if (sql.includes("count(*)")) return { rows: [{ count: String(sql.includes("interval '1 minute'") ? minute : daily) }] };
  if (sql.includes("sum(estimated_cost_cents)")) return { rows: [{ spent: String(spent), calls: String(calls) }] };
  if (sql.includes("RETURNING id")) return { rowCount: 1, rows: [{ id: 42 }] };
  return { rowCount: 1 };
}

test("duplicate and uncertain attempts are not charged or retried", async () => {
  const { pool, calls } = fakePool((sql) => responses(sql, { duplicate: true }));
  assert.equal(await reserveAmenityDetails("abc", options, pool), "duplicate");
  assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")), false);
  assert.equal(calls.some(({ sql }) => sql === "COMMIT"), true);
});

test("quota stops without a ledger entry; monthly exhaustion records a zero-cost denial", async () => {
  for (const config of [{ daily: 10, expected: "quota" }, { minute: 1, expected: "quota" },
    { spent: 2990, expected: "budget" }]) {
    const { pool, calls } = fakePool((sql) => responses(sql, config));
    assert.equal(await reserveAmenityDetails("abc", options, pool), config.expected);
    const entries = calls.filter(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs"));
    if (config.expected === "budget") {
      assert.equal(entries.length, 1);
      assert.match(entries[0].sql, /0, 0, \$1, 'Place Details amenities denied: monthly budget'/);
      assert.deepEqual(entries[0].params, [3000]);
      assert.equal(calls.at(-2).sql, "COMMIT");
    } else assert.equal(entries.length, 0);
  }
});

test("the charge and one-time claim commit together before any external call", async () => {
  const { pool, calls } = fakePool((sql) => responses(sql));
  assert.equal(await reserveAmenityDetails("abc", options, pool), "reserved");
  assert.ok(calls.findIndex(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")) <
    calls.findIndex(({ sql }) => sql.includes("INSERT INTO place_amenity_checks")));
  assert.equal(calls.at(-2).sql, "COMMIT");
  assert.deepEqual(calls.find(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")).params, [80, 3000]);
});

test("reservation failures roll back and retain no claim", async () => {
  const { pool, calls } = fakePool((sql) => {
    if (sql.includes("INSERT INTO restaurant_import_runs")) throw new Error("db unavailable");
    return responses(sql);
  });
  await assert.rejects(reserveAmenityDetails("abc", options, pool), /db unavailable/);
  assert.ok(calls.some(({ sql }) => sql === "ROLLBACK"));
  assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO place_amenity_checks")), false);
});

test("unknown fields complete without updating amenities; positive values fill only unclaimed null rows", async () => {
  for (const amenities of [null, ["delivery"]]) {
    const { pool, calls } = fakePool((sql) => sql.includes("RETURNING id")
      ? { rowCount: 1, rows: [{ id: 42 }] } : { rowCount: 1 });
    await completeAmenityDetails("abc", amenities, pool);
    const update = calls.find(({ sql }) => sql.includes("UPDATE restaurants"));
    if (amenities === null) assert.equal(update, undefined);
    else {
      assert.deepEqual(update.params, ["abc", amenities]);
      assert.match(update.sql, /amenities IS NULL.*source_name = 'google'/s);
      assert.match(update.sql, /claimed_at IS NULL/);
    }
  }
});

const oldCheck = { id: 2, status: "completed", mode: "initial",
  completed_at: new Date("2025-01-01"), observed_amenities: ["delivery"], review_decision: null };

test("only eligible old completed checks can reserve a billed refresh", async () => {
  for (const latest of [null, { ...oldCheck, status: "pending" }, { ...oldCheck, status: "failed" },
    { ...oldCheck, completed_at: new Date() },
    { ...oldCheck, mode: "refresh", review_decision: null }]) {
    const { pool, calls } = fakePool((sql) => responses(sql, { latest }));
    assert.equal(await reserveRefreshAmenityDetails("abc", options, pool), "duplicate");
    assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")), false);
  }
  const { pool, calls } = fakePool((sql) => responses(sql, { latest: oldCheck, baseline: ["delivery"] }));
  assert.equal(await reserveRefreshAmenityDetails("abc", options, pool), 42);
  assert.deepEqual(calls.find(({ sql }) => sql.includes("INSERT INTO place_amenity_checks")).params,
    ["abc", 42, "refresh", ["delivery"]]);
});

test("a refresh observation is staged without changing the restaurant", async () => {
  const { pool, calls } = fakePool(() => ({ rowCount: 1 }));
  await completeRefreshAmenityDetails(42, ["takeaway"], pool);
  assert.equal(calls.some(({ sql }) => sql.includes("UPDATE restaurants")), false);
  assert.deepEqual(calls.find(({ sql }) => sql.includes("UPDATE place_amenity_checks")).params,
    [42, ["takeaway"]]);
});

test("review requires proven baseline, matching restaurant values and one decision", async () => {
  for (const { approve, proven, updated, expected } of [
    { approve: true, proven: true, updated: true, expected: "applied" },
    { approve: true, proven: true, updated: false, expected: "conflict" },
    { approve: true, proven: false, updated: false, expected: "conflict" },
    { approve: false, proven: false, updated: false, expected: "rejected" },
  ]) {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes("SELECT place_id, observed_amenities")) return {
        rowCount: 1, rows: [{ place_id: "abc", baseline_amenities: ["delivery"], observed_amenities: ["takeaway"] }],
      };
      if (sql.includes("AS matches")) return {
        rowCount: 1, rows: [{ matches: proven }],
      };
      if (sql.includes("UPDATE restaurants")) return { rowCount: updated ? 1 : 0 };
      return { rowCount: 1 };
    });
    assert.equal(await reviewRefreshAmenityDetails(42, "operator", "venue reviewed", approve, pool), expected);
    assert.equal(calls.find(({ sql }) => sql.includes("UPDATE restaurants")) !== undefined, approve && proven);
    assert.equal(calls.find(({ sql }) => sql.includes("review_decision =")).params[3], expected);
  }
});

test("already reviewed or unknown observations cannot be applied again", async () => {
  const { pool, calls } = fakePool(() => ({ rowCount: 0 }));
  await assert.rejects(reviewRefreshAmenityDetails(42, "operator", "note", true, pool), /No reviewable/);
  assert.equal(calls.some(({ sql }) => sql.includes("UPDATE restaurants")), false);
  assert.ok(calls.some(({ sql }) => sql === "ROLLBACK"));
});

test("a cleared owner value cannot be overwritten by a refresh", async () => {
  const { pool, calls } = fakePool((sql) => {
    if (sql.includes("SELECT place_id, observed_amenities")) return {
      rowCount: 1, rows: [{ place_id: "abc", baseline_amenities: null, observed_amenities: ["delivery"] }],
    };
    if (sql.includes("AS matches")) return { rowCount: 1, rows: [{ matches: false }] };
    return { rowCount: 1 };
  });
  assert.equal(await reviewRefreshAmenityDetails(42, "operator", "reviewed", true, pool), "conflict");
  assert.equal(calls.some(({ sql }) => sql.includes("UPDATE restaurants")), false);
});

test("a non-pending attempt cannot be completed or overwrite restaurant data", async () => {
  const { pool, calls } = fakePool((sql) =>
    sql.includes("UPDATE place_amenity_checks") ? { rowCount: 0 } : { rowCount: 1 });
  await assert.rejects(completeAmenityDetails("abc", ["delivery"], pool), /not pending/);
  assert.equal(calls.some(({ sql }) => sql.includes("UPDATE restaurants")), false);
  assert.ok(calls.some(({ sql }) => sql === "ROLLBACK"));
});