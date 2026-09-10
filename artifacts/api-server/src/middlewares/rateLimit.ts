import rateLimit from "express-rate-limit";

export const pubsubRateLimit = rateLimit({
  windowMs: 10 * 1000,
  max: 50,
  message: "Too many requests",
  // Mount after OIDC verification. Proxy IPs do not identify Pub/Sub senders.
  keyGenerator: (req) => req.googleOidc?.sub ?? "unverified",
  standardHeaders: "draft-8",
  legacyHeaders: false,
});