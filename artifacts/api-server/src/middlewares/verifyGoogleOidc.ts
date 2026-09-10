import { OAuth2Client, type TokenPayload } from "google-auth-library";
import type { RequestHandler } from "express";
import { assertPublicHttpsUrl } from "../lib/public-url";
import { logOidcPayload } from "../utils/logOidc";
import { logEvent } from "../utils/eventLog";

declare global {
  namespace Express {
    interface Request {
      googleOidc?: TokenPayload;
    }
  }
}

const client = new OAuth2Client();

// The audience is the configured public push URL, never a request Host header.
export const verifyGoogleOidc: RequestHandler = async (req, res, next) => {
  try {
    const token = req.header("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
    const expectedEmail = process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT;
    if (!token || token.length > 10_000 || !expectedEmail) {
      throw new Error("Invalid Pub/Sub identity.");
    }
    const origin = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL, { canonical: true });
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: `${origin.origin}/api/gmail/push`,
    });
    const payload = ticket.getPayload();
    if (
      !payload ||
      (payload.iss !== "accounts.google.com" &&
        payload.iss !== "https://accounts.google.com") ||
      payload.email_verified !== true ||
      payload.email !== expectedEmail
    ) {
      throw new Error("Invalid Pub/Sub identity.");
    }
    logOidcPayload(payload);
    req.googleOidc = payload;
    logEvent("success", "OIDC verified");
  } catch {
    res.status(401).json({ error: "Invalid Pub/Sub identity." });
    return;
  }
  next();
};

export default verifyGoogleOidc;