import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PURPOSE = "restaurant_claim";
const VERSION = "v1";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MINIMUM_SECRET_BYTES = 32;

type ClaimLinkPayload = {
  purpose: typeof PURPOSE;
  placeId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export class ClaimLinkConfigurationError extends Error {}

function claimLinkSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (
    !secret
    || Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES
    || /^(.)\1+$/.test(secret)
  ) {
    throw new ClaimLinkConfigurationError(
      "SESSION_SECRET must be a non-repeating value of at least 32 bytes before claim links can be issued or verified.",
    );
  }
  return secret;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${VERSION}.${encodedPayload}`)
    .digest("base64url");
}

function validPlaceId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Creates a short-lived, purpose-bound link token. This function has no HTTP
 * entry point: outreach is the only production issuer.
 */
export function issueClaimLink(
  placeId: string,
  now = Math.floor(Date.now() / 1_000),
): string {
  if (!validPlaceId(placeId)) throw new Error("A valid place ID is required.");
  const payload: ClaimLinkPayload = {
    purpose: PURPOSE,
    placeId,
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = encode(payload);
  return `${VERSION}.${encodedPayload}.${sign(encodedPayload, claimLinkSecret())}`;
}

/**
 * Validates a token without exposing which check failed. The route atomically
 * transitions an unclaimed listing, so an already claimed listing is never
 * overwritten by a replayed link.
 */
export function verifyClaimLink(
  token: string,
  placeId: string,
  now = Math.floor(Date.now() / 1_000),
): boolean {
  if (typeof token !== "string" || token.length < 40 || token.length > 2_048) {
    return false;
  }
  const [version, encodedPayload, suppliedSignature, ...rest] = token.split(".");
  if (
    version !== VERSION
    || !encodedPayload
    || !suppliedSignature
    || rest.length !== 0
  ) {
    return false;
  }

  const expectedSignature = sign(encodedPayload, claimLinkSecret());
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (
    expected.length !== supplied.length
    || !timingSafeEqual(expected, supplied)
  ) {
    return false;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    return false;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const candidate = payload as Partial<ClaimLinkPayload>;
  return candidate.purpose === PURPOSE
    && candidate.placeId === placeId
    && validPlaceId(candidate.placeId)
    && typeof candidate.issuedAt === "number"
    && Number.isSafeInteger(candidate.issuedAt)
    && typeof candidate.expiresAt === "number"
    && Number.isSafeInteger(candidate.expiresAt)
    && candidate.issuedAt <= now
    && candidate.expiresAt === candidate.issuedAt + TOKEN_TTL_SECONDS
    && candidate.expiresAt > now
    && typeof candidate.nonce === "string"
    && /^[A-Za-z0-9_-]{22}$/.test(candidate.nonce);
}
