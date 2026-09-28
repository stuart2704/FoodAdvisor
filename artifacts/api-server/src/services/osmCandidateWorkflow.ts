import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import type { OsmOwnerDraftData } from "@workspace/db";

export const OSM_SOURCE = "OSM";
export const CLAIM_INVITE_TTL_MS = 48 * 60 * 60 * 1_000;
export const OWNER_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1_000;
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5;
export const MAX_CLAIM_INVITES = 3;
export const MIN_INVITE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
export const AUTO_INVITE_REVIEW_DELAY_MS = 48 * 60 * 60 * 1_000;

export function validBusinessEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

export function autoInviteEligibility(input: {
  reviewed: boolean;
  reviewedAt: Date | null;
  highConfidence: boolean;
  suppressed: boolean;
  published: boolean;
  claimed: boolean;
  outreachBlocked: boolean;
  autoInviteEnabled: boolean;
  approvedContactEmail: string | null;
  contactEvidence: string | null;
  contactApprovedAt: Date | null;
  inviteCount: number;
}, latest: { status: string; createdAt: Date } | undefined, now: Date): {
  status: "disabled" | "waiting" | "due" | "sent" | "failed" | "unknown" | "complete" | "ineligible";
  dueAt: Date | null;
} {
  if (!input.autoInviteEnabled) return { status: "disabled", dueAt: null };
  if (!input.reviewed || !input.highConfidence || input.suppressed || input.published
      || input.claimed || input.outreachBlocked || !input.reviewedAt
      || !input.contactApprovedAt || !input.contactEvidence?.trim()
      || !input.approvedContactEmail || !validBusinessEmail(input.approvedContactEmail)) {
    return { status: "ineligible", dueAt: null };
  }
  if (latest?.status === "reserved" || latest?.status === "unknown") {
    return { status: "unknown", dueAt: null };
  }
  if (input.inviteCount >= MAX_CLAIM_INVITES) {
    return { status: latest?.status === "failed" ? "failed" : latest?.status === "sent" ? "sent" : "complete", dueAt: null };
  }
  const dueAt = new Date(Math.max(
    input.reviewedAt.getTime() + AUTO_INVITE_REVIEW_DELAY_MS,
    input.contactApprovedAt.getTime() + AUTO_INVITE_REVIEW_DELAY_MS,
    latest ? latest.createdAt.getTime() + MIN_INVITE_INTERVAL_MS : 0,
  ));
  if (dueAt.getTime() > now.getTime()) {
    return { status: latest?.status === "sent" ? "sent" : latest?.status === "failed" ? "failed" : "waiting", dueAt };
  }
  return { status: "due", dueAt };
}

export type OsmCandidateState =
  | "unverified"
  | "reviewed"
  | "claim_invited"
  | "claim_verified"
  | "activated"
  | "published"
  | "suppressed";

export type OsmEvidenceStatus =
  | "not_submitted"
  | "pending"
  | "approved"
  | "rejected";

export function requiredFieldsComplete(draft: OsmOwnerDraftData): boolean {
  return Boolean(
    draft.name.trim()
      && draft.address?.trim()
      && draft.city?.trim()
      && Number.isFinite(draft.latitude)
      && Number.isFinite(draft.longitude)
      && draft.latitude !== null
      && draft.longitude !== null
      && Math.abs(draft.latitude) <= 90
      && Math.abs(draft.longitude) <= 180,
  );
}

export function hashOpaqueSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashVerificationCode(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (
    !secret
    || Buffer.byteLength(secret, "utf8") < 32
    || /^(.)\1+$/.test(secret)
  ) {
    throw new Error("Secure verification is not configured.");
  }
  return createHmac("sha256", secret)
    .update(`osm-claim-code:v1:${value}`)
    .digest("hex");
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createVerificationCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

export function normalizeOsmState(
  current: OsmCandidateState,
  flags: {
    reviewed: boolean;
    claimed: boolean;
    identityVerified: boolean;
    ownershipStatus: OsmEvidenceStatus;
    rightsStatus: OsmEvidenceStatus;
    suppressed: boolean;
    published: boolean;
  },
): OsmCandidateState {
  if (flags.suppressed || current === "suppressed") return "suppressed";
  if (flags.published || current === "published") return "published";
  if (current === "activated") return "activated";
  if (
    flags.reviewed
      && flags.claimed
      && flags.identityVerified
      && flags.ownershipStatus === "approved"
      && flags.rightsStatus === "approved"
  ) {
    return "claim_verified";
  }
  if (current === "claim_invited" || flags.claimed) return "claim_invited";
  if (flags.reviewed) return "reviewed";
  return "unverified";
}

export function activationPreconditions(input: {
  state: OsmCandidateState;
  reviewed: boolean;
  claimed: boolean;
  identityVerified: boolean;
  ownershipStatus: OsmEvidenceStatus;
  rightsStatus: OsmEvidenceStatus;
  suppressed: boolean;
  published: boolean;
  draft: OsmOwnerDraftData;
}): { eligible: true } | { eligible: false; reason: string } {
  if (input.suppressed || input.state === "suppressed") {
    return { eligible: false, reason: "candidate_suppressed" };
  }
  if (!input.reviewed) return { eligible: false, reason: "candidate_not_reviewed" };
  if (!input.claimed) return { eligible: false, reason: "candidate_not_claimed" };
  if (!input.identityVerified) {
    return { eligible: false, reason: "contact_channel_not_verified" };
  }
  if (input.ownershipStatus !== "approved") {
    return { eligible: false, reason: "ownership_evidence_not_approved" };
  }
  if (input.rightsStatus !== "approved") {
    return { eligible: false, reason: "source_rights_not_approved" };
  }
  if (!requiredFieldsComplete(input.draft)) {
    return { eligible: false, reason: "required_fields_incomplete" };
  }
  if (input.published || input.state === "published") {
    return { eligible: false, reason: "candidate_already_published" };
  }
  return { eligible: true };
}

/**
 * A promoted private draft may return to claim_verified when the owner
 * resubmits evidence after a failed activation. Review and rights must be
 * freshly approved, but repeating promotion is neither needed nor safe.
 */
export function publicationPreconditions(input: Parameters<typeof activationPreconditions>[0] & {
  candidateStatus: string | undefined;
  restaurantPlaceId: string | null;
  promoted: boolean;
  enriched: boolean;
  scored: boolean;
}): { eligible: true } | { eligible: false; reason: string } {
  const gate = activationPreconditions(input);
  if (!gate.eligible) return gate;
  if (input.candidateStatus !== "verified") return { eligible: false, reason: "candidate_not_reviewed" };
  if (!input.promoted || !input.enriched || !input.scored || !input.restaurantPlaceId) {
    return { eligible: false, reason: "activation_steps_incomplete" };
  }
  if (input.state !== "activated" && input.state !== "claim_verified") {
    return { eligible: false, reason: "claim_state_not_ready" };
  }
  return { eligible: true };
}

export function isCurrentEvidenceSubmission(input: {
  kind: "ownership" | "source_rights";
  status: string;
  description: string;
  submittedAt: Date | null;
  sourceAttribution: string | null;
}): boolean {
  return input.status === "pending"
    && input.description.trim().length >= 10
    && input.submittedAt instanceof Date
    && !Number.isNaN(input.submittedAt.getTime())
    && (input.kind !== "source_rights"
      || /openstreetmap/i.test(input.sourceAttribution ?? ""));
}

export function safeProviderErrorCode(error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (typeof status === "number" && Number.isInteger(status)) {
    return `provider_http_${status}`;
  }
  return "provider_outcome_unknown";
}