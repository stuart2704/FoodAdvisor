import assert from "node:assert/strict";
import { test } from "node:test";
import { completeAmenityDetails, reserveAmenityDetails } from "./placeAmenityReservations.ts";

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

function responses(sql, { duplicate = false, daily = 0, spent = 0, calls = 0 } = {}) {
  if (sql.includes("FROM crawler_progress")) return { rowCount: 1, rows: [{ monthly_budget_cents: 3000 }] };
  if (sql.includes("SELECT 1 FROM place_amenity_checks")) return { rowCount: duplicate ? 1 : 0 };
  if (sql.includes("SELECT 1 FROM restaurants")) return { rowCount: 1 };
  if (sql.includes("count(*)")) return { rows: [{ count: String(daily) }] };
  if (sql.includes("sum(estimated_cost_cents)")) return { rows: [{ spent: String(spent), calls: String(calls) }] };
  if (sql.includes("RETURNING id")) return { rows: [{ id: 42 }] };
  return { rowCount: 1 };
}

test("duplicate and uncertain attempts are not charged or retried", async () => {
  const { pool, calls } = fakePool((sql) => responses(sql, { duplicate: true }));
  assert.equal(await reserveAmenityDetails("abc", options, pool), "duplicate");
  assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")), false);
  assert.equal(calls.some(({ sql }) => sql === "COMMIT"), true);
});

test("quota or shared budget exhaustion stops before the provider and ledger", async () => {
  for (const config of [{ daily: 10, expected: "quota" }, { spent: 2990, expected: "budget" }]) {
    const { pool, calls } = fakePool((sql) => responses(sql, config));
    assert.equal(await reserveAmenityDetails("abc", options, pool), config.expected);
    assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs")), false);
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
    const { pool, calls } = fakePool(() => ({ rowCount: 1 }));
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

test("a non-pending attempt cannot be completed or overwrite restaurant data", async () => {
  const { pool, calls } = fakePool((sql) =>
    sql.includes("UPDATE place_amenity_checks") ? { rowCount: 0 } : { rowCount: 1 });
  await assert.rejects(completeAmenityDetails("abc", ["delivery"], pool), /not pending/);
  assert.equal(calls.some(({ sql }) => sql.includes("UPDATE restaurants")), false);
  assert.ok(calls.some(({ sql }) => sql === "ROLLBACK"));
});