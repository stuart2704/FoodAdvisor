import rateLimit from "express-rate-limit";

export const pubsubRateLimit = rateLimit({
  windowMs: 10 * 1000,
  max: 50,
  message: "Too many requests",
});