import assert from "node:assert/strict";
import { test } from "node:test";
import { pool } from "@workspace/db";
import { billingGate, runGovernmentSource, sourceIsPublishable, sourceKey } from "./importer.ts";

test("only reviewed jurisdictions can enter the publication path", () => {
  assert.equal(sourceIsPublishable("FSA_UK"), true);
  assert.equal(sourceIsPublishable("ALIM_FR"), true);
  assert.equal(sourceIsPublishable("NYC_DOHMH"), false);
  assert.equal(sourceKey({ source: "FSA_UK", sourceId: "123" }), "gov:fsa_uk:123");
  assert.equal(sourceKey({ source: "ALIM_FR", sourceId: "123" }), "gov:alim_fr:123");
});

test("no automatic import can begin without an account-specific cost meter", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal((await billingGate()).ready, false);
    assert.equal((await runGovernmentSource("FSA_UK")).status, "blocked");
    assert.equal((await runGovernmentSource("NYC_DOHMH")).status, "blocked");
  } finally {
    process.env.NODE_ENV = previous;
    await pool.end();
  }
});