import assert from "node:assert/strict";
import { test } from "node:test";
import { validAutomationToken, validSocialAutomationToken } from "./automation-auth.ts";

test("social automation uses only its dedicated credential", () => {
  const originalSocial = process.env.SOCIAL_AUTOMATION_TOKEN;
  const originalShared = process.env.AUTOMATION_TOKEN;
  const shared = "shared-" + "a".repeat(40);
  const social = "social-" + "b".repeat(40);
  try {
    process.env.AUTOMATION_TOKEN = shared;
    delete process.env.SOCIAL_AUTOMATION_TOKEN;
    assert.equal(validSocialAutomationToken(`Bearer ${shared}`), false);
    assert.equal(validAutomationToken(`Bearer ${shared}`), true);

    process.env.SOCIAL_AUTOMATION_TOKEN = "short";
    assert.equal(validSocialAutomationToken("Bearer short"), false);

    process.env.SOCIAL_AUTOMATION_TOKEN = social;
    assert.equal(validSocialAutomationToken(`Bearer ${social}`), true);
    assert.equal(validSocialAutomationToken(`Bearer ${shared}`), false);
    assert.equal(validSocialAutomationToken(`Bearer ${social}extra`), false);
    assert.equal(validAutomationToken(`Bearer ${shared}`), true);
    assert.equal(validAutomationToken(`Bearer ${social}`), false);
  } finally {
    if (originalSocial === undefined) delete process.env.SOCIAL_AUTOMATION_TOKEN;
    else process.env.SOCIAL_AUTOMATION_TOKEN = originalSocial;
    if (originalShared === undefined) delete process.env.AUTOMATION_TOKEN;
    else process.env.AUTOMATION_TOKEN = originalShared;
  }
});