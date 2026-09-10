import type { TokenPayload } from "google-auth-library";
import { logger } from "../lib/logger";

// For verified payloads only. Deliberately exclude tokens and all other claims.
export function logOidcPayload(payload: TokenPayload & { jti?: string }): void {
  logger.debug(
    {
      iss: payload.iss,
      email: payload.email,
      audience: payload.aud,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      tokenId: payload.jti,
    },
    "Verified Google OIDC payload metadata",
  );
}