import assert from "node:assert/strict";
import { test } from "node:test";
import { pool } from "@workspace/db";
import { budgetedPlacesFetch, PlacesBudgetExceededError } from "./budgetedPlacesFetch.ts";

test("an exhausted ledger refuses the request before contacting Google", async (t) => {
  const statements = [];
  t.mock.method(pool, "connect", async () => ({
    async query(sql) {
      statements.push(sql);
      if (sql.includes("SELECT monthly_budget_cents")) {
        return { rowCount: 1, rows: [{ monthly_budget_cents: 3000 }] };
      }
      if (sql.includes("SELECT coalesce(sum")) {
        return { rows: [{ spent: "3000", calls: "60" }] };
      }
      return { rows: [] };
    },
    release() {},
  }));
  const provider = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Google must not be called after the budget is exhausted.");
  });

  await assert.rejects(
    budgetedPlacesFetch("https://places.googleapis.com/v1/places/example", {}, "Test details"),
    PlacesBudgetExceededError,
  );
  assert.equal(provider.mock.callCount(), 0);
  assert.equal(statements.filter((statement) => statement.includes("INSERT INTO")).length, 1);
  assert.ok(statements.some((statement) => statement.includes("VALUES ($1, 1, 0, 0, 0, 0, $2, $3)")));
});

test("a blocked photo request records only its category with zero calls and cost", async (t) => {
  const queries = [];
  t.mock.method(pool, "connect", async () => ({
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT monthly_budget_cents")) return { rowCount: 1, rows: [{ monthly_budget_cents: 3000 }] };
      if (sql.includes("SELECT coalesce(sum")) return { rows: [{ spent: "3000", calls: "60" }] };
      return { rows: [] };
    },
    release() {},
  }));
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Provider called"); });
  await assert.rejects(
    budgetedPlacesFetch("https://places.googleapis.com/v1/places/private-id", {}, "Place photo media"),
    PlacesBudgetExceededError,
  );
  const denial = queries.find(({ sql }) => sql.includes("INSERT INTO restaurant_import_runs"));
  assert.deepEqual(denial.params, [["Place photo media"], 3000, "Places request denied: Place photo media"]);
  assert.equal(provider.mock.callCount(), 0);
  assert.equal(queries.at(-1).sql, "COMMIT");
});