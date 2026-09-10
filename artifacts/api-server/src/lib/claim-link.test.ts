import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ClaimLinkConfigurationError,
  issueClaimLink,
  verifyClaimLink,
} from "./claim-link.ts";

const originalSecret = process.env.SESSION_SECRET;
const secureSecret = "test-session-secret-with-at-least-thirty-two-bytes";

function restoreSecret(): void {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
}

test("claim links fail closed when SESSION_SECRET is missing or weak", () => {
  try {
    delete process.env.SESSION_SECRET;
    assert.throws(
      () => issueClaimLink("place-1", 1_000),
      ClaimLinkConfigurationError,
    );

    process.env.SESSION_SECRET = "a".repeat(32);
    assert.throws(
      () => issueClaimLink("place-1", 1_000),
      ClaimLinkConfigurationError,
    );
  } finally {
    restoreSecret();
  }
});

test("claim links reject a wrong secret, expiry, and another restaurant", () => {
  try {
    process.env.SESSION_SECRET = secureSecret;
    const token = issueClaimLink("place-1", 1_000);
    assert.equal(verifyClaimLink(token, "place-1", 1_001), true);
    assert.equal(verifyClaimLink(token, "place-2", 1_001), false);
    assert.equal(verifyClaimLink(token, "place-1", 1_000 + 7 * 24 * 60 * 60), false);

    process.env.SESSION_SECRET = "another-test-session-secret-with-32-bytes";
    assert.equal(verifyClaimLink(token, "place-1", 1_001), false);
  } finally {
    restoreSecret();
  }
});

test("HTTP request logging strips token-bearing query strings", async () => {
  const appSource = await readFile(new URL("../app.ts", import.meta.url), "utf8");
  assert.match(appSource, /url:\s*req\.url\?\.split\("\?"\)\[0\]/);
});