import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyBusinessEmailResearch,
  countBusinessEmailResearchOutcome,
} from "./businessEmailResearchRules.ts";

test("website without a qualifying role mailbox is queued for research", () => {
  assert.deepEqual(classifyBusinessEmailResearch({
    websitePresent: true,
    extractionSucceeded: true,
    email: null,
    emailSourceUrl: "https://restaurant.example/contact",
  }), {
    status: "no_business_email",
    email: null,
    emailSourceUrl: "https://restaurant.example/contact",
    reason: "No allowlisted role mailbox was published.",
    auditEvent: "email_not_found",
    extractionSucceeded: true,
  });
});

test("website extraction errors are distinguished from an absent email", () => {
  assert.deepEqual(classifyBusinessEmailResearch({
    websitePresent: true,
    extractionSucceeded: false,
    extractionError: "Website hostname could not be resolved.",
  }), {
    status: "extraction_failed",
    email: null,
    emailSourceUrl: null,
    reason: "Website hostname could not be resolved.",
    auditEvent: "extraction_failed",
    extractionSucceeded: false,
  });
});

test("a missing website and a qualifying address have explicit outcomes", () => {
  assert.equal(classifyBusinessEmailResearch({
    websitePresent: false,
    extractionSucceeded: false,
  }).reason, "Restaurant has no website to check.");
  assert.deepEqual(classifyBusinessEmailResearch({
    websitePresent: true,
    extractionSucceeded: true,
    email: "info@restaurant.example",
    emailSourceUrl: "https://restaurant.example",
  }), {
    status: "pending",
    email: "info@restaurant.example",
    emailSourceUrl: "https://restaurant.example",
    reason: null,
    auditEvent: "email_discovered",
    extractionSucceeded: true,
  });
});

test("paid import enrichment counters reflect website-check outcomes", () => {
  const counts = { succeeded: 0, failed: 0, skipped: 0 };
  countBusinessEmailResearchOutcome(counts, "succeeded");
  countBusinessEmailResearchOutcome(counts, "failed");
  countBusinessEmailResearchOutcome(counts, "skipped");
  assert.deepEqual(counts, { succeeded: 1, failed: 1, skipped: 1 });
});