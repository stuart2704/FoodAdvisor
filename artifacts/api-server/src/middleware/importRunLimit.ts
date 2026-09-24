import rateLimit from "express-rate-limit";

// Share the same bucket across the legacy and dashboard aliases. Budget
// reservations are still enforced separately immediately before each paid call.
export const importRunLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many import runs. Try again later." },
});