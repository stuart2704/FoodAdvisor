import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  activationPreconditions,
  isCurrentEvidenceSubmission,
  publicationPreconditions,
} from "../services/osmCandidateWorkflow.ts";
import { redactRequestUrl } from "../lib/requestUrlRedaction.ts";

const here = dirname(fileURLToPath(import.meta.url));
const readSource = (path) => readFile(resolve(here, path), "utf8");

test("claim invitation tokens are redacted from path and query logging", () => {
  assert.equal(
    redactRequestUrl("/api/claim/osm%2F123/secret-token?tracking=1"),
    "/api/claim/osm%2F123/[REDACTED]",
  );
  assert.equal(redactRequestUrl("/api/claim/exchange?claimToken=secret"), "/api/claim/exchange");
});

test("admin dashboard route is mounted at canonical /api path and legacy root", async () => {
  const source = await readSource("../app.ts");
  assert.match(source, /app\.use\(osmCandidateWorkflowAdminRouter\)/);
  assert.match(source, /app\.use\("\/api", osmCandidateWorkflowAdminRouter\)/);
});

test("evidence decisions require the current valid pending submission", () => {
  const submittedAt = new Date("2025-01-01T00:00:00.000Z");
  const evidence = {
    kind: "ownership",
    status: "pending",
    description: "The restaurant owner has supplied proof.",
    submittedAt,
    sourceAttribution: null,
  };
  assert.equal(isCurrentEvidenceSubmission(evidence), true);
  assert.equal(isCurrentEvidenceSubmission({ ...evidence, status: "approved" }), false);
  assert.equal(isCurrentEvidenceSubmission({ ...evidence, status: "rejected" }), false);
  assert.equal(isCurrentEvidenceSubmission({ ...evidence, description: "short" }), false);
  assert.equal(isCurrentEvidenceSubmission({ ...evidence, submittedAt: null }), false);
  assert.equal(isCurrentEvidenceSubmission({
    ...evidence,
    kind: "source_rights",
    sourceAttribution: "OpenStreetMap contributors",
  }), true);
  assert.equal(isCurrentEvidenceSubmission({
    ...evidence,
    kind: "source_rights",
    sourceAttribution: "A different provider",
  }), false);
});

test("public result engines explicitly exclude unpublished restaurants", async () => {
  const files = [
    "../services/recommendationEngine.ts",
    "../services/cuisinePageEngine.ts",
    "../routes/collections.ts",
    "../routes/match.ts",
    "../routes/heatmap.ts",
  ];
  const sources = await Promise.all(files.map(readSource));
  for (const source of sources) assert.match(source, /restaurantsTable\.published/);
});

test("activation retries short-circuit published workflows and use workflow advisory locks", async () => {
  const source = await readSource("../routes/osmClaimWorkflowOwner.ts");
  assert.match(source, /if \(evaluated\.context\.workflow\.published\)/);
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(\$\{OSM_SOURCE\}\), hashtext\(\$\{sourceId\}\)\)/);
  assert.match(source, /if \(current\.published\) return/);
});

test("suppression remains terminal and publication-safe", async () => {
  const source = await readSource("../routes/osmCandidateWorkflowAdmin.ts");
  assert.match(source, /if \(current\.published\) return "published" as const/);
  assert.match(source, /state: "suppressed",[\s\S]*suppressed: true/);
  assert.match(source, /isNull\(osmClaimInvitesTable\.usedAt\)/);
  assert.match(source, /isNull\(osmOwnerSessionsTable\.revokedAt\)/);
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(\$\{OSM_SOURCE\}\), hashtext\(\$\{params\.data\.sourceId\}\)\)/);
});

test("suppressed and already-published workflows fail activation preconditions", () => {
  const base = {
    state: "claim_verified",
    reviewed: true,
    claimed: true,
    identityVerified: true,
    ownershipStatus: "approved",
    rightsStatus: "approved",
    suppressed: false,
    published: false,
    draft: {
      name: "Sample",
      address: "1 Main Street",
      city: "Cardiff",
      phone: null,
      website: null,
      description: null,
      openingHours: [],
      latitude: 51.48,
      longitude: -3.18,
    },
  };
  assert.deepEqual(
    activationPreconditions({ ...base, suppressed: true }),
    { eligible: false, reason: "candidate_suppressed" },
  );
  assert.deepEqual(
    activationPreconditions({ ...base, state: "published", published: true }),
    { eligible: false, reason: "candidate_already_published" },
  );
  for (const changes of [
    { reviewed: false, highConfidence: true },
    { claimed: false },
    { identityVerified: false },
    { ownershipStatus: "pending" },
    { ownershipStatus: "rejected" },
    { rightsStatus: "pending" },
    { rightsStatus: "rejected" },
  ]) {
    assert.equal(activationPreconditions({ ...base, ...changes }).eligible, false);
  }
  assert.deepEqual(activationPreconditions(base), { eligible: true });
});

test("private drafts and publication are tied to the reviewed candidate and current evidence", async () => {
  const source = await readSource("../routes/osmClaimWorkflowOwner.ts");
  assert.match(source, /identityVerified: true,[\s\S]*published: false,[\s\S]*restaurantPlaceId: placeId/);
  assert.match(source, /candidateStatus: candidate\?\.verificationStatus/);
  assert.match(source, /promoted: activation\?\.promoted \?\? false/);
  assert.match(source, /item\.kind === "source_rights" && item\.status === "approved"[\s\S]*item\.reviewedAt && \/openstreetmap\/i/);
  assert.match(source, /eq\(restaurantsTable\.sourceId, sourceId\),\s*eq\(restaurantsTable\.published, false\)/);
});

test("a promoted draft can publish after evidence is resubmitted and approved again", () => {
  const base = {
    state: "activated",
    reviewed: true,
    claimed: true,
    identityVerified: true,
    ownershipStatus: "approved",
    rightsStatus: "approved",
    suppressed: false,
    published: false,
    candidateStatus: "verified",
    restaurantPlaceId: "osm:osm%3Anode%3A123",
    promoted: true,
    enriched: true,
    scored: true,
    draft: {
      name: "Sample", address: "1 Main Street", city: "Cardiff",
      phone: null, website: null, description: null, openingHours: [],
      latitude: 51.48, longitude: -3.18,
    },
  };
  assert.deepEqual(publicationPreconditions(base), { eligible: true });
  const resubmitted = {
    ...base, state: "claim_invited", ownershipStatus: "pending", rightsStatus: "pending",
  };
  assert.equal(publicationPreconditions(resubmitted).eligible, false);
  assert.equal(publicationPreconditions({ ...resubmitted, ownershipStatus: "approved" }).eligible, false);
  const reapproved = {
    ...resubmitted, state: "claim_verified", ownershipStatus: "approved", rightsStatus: "approved",
  };
  assert.deepEqual(publicationPreconditions(reapproved), { eligible: true });
  assert.equal(publicationPreconditions({ ...reapproved, candidateStatus: "rejected" }).eligible, false);
  assert.equal(publicationPreconditions({ ...reapproved, promoted: false }).eligible, false);
  assert.equal(publicationPreconditions({ ...reapproved, suppressed: true }).eligible, false);
});

test("Google provider routes verify publication and source before cached/provider reads", async () => {
  const source = await readSource("../routes/google-reviews.ts");
  assert.equal((source.match(/requireGoogleRestaurant\(placeId, res\)/g) ?? []).length, 4);
  assert.match(source, /restaurant\.sourceName !== "google"/);
  assert.match(source, /!restaurant\.published/);
});