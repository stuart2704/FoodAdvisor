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
  assert.equal(statements.some((statement) => statement.includes("INSERT INTO")), false);
});