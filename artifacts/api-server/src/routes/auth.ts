import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcrypt";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const router: IRouter = Router();

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(500),
  })
  .strict();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

function equalEmail(supplied: string, expected: string): boolean {
  const suppliedHash = createHash("sha256")
    .update(supplied.trim().toLowerCase())
    .digest();
  const expectedHash = createHash("sha256")
    .update(expected.trim().toLowerCase())
    .digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

function equalPassword(supplied: string, expected: string): boolean {
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

router.post("/login", loginLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ success: false, error: "Invalid email or password." });
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.SESSION_SECRET;
  if (
    !adminEmail ||
    (!adminPassword && !passwordHash) ||
    !sessionSecret ||
    sessionSecret.length < 32
  ) {
    req.log.error("Admin authentication is not fully configured");
    res.status(503).json({ success: false, error: "Admin login is unavailable." });
    return;
  }

  try {
    const [emailMatches, passwordMatches] = await Promise.all([
      Promise.resolve(equalEmail(parsed.data.email, adminEmail)),
      adminPassword
        ? Promise.resolve(equalPassword(parsed.data.password, adminPassword))
        : bcrypt.compare(parsed.data.password, passwordHash!),
    ]);
    if (!emailMatches || !passwordMatches) {
      res.status(401).json({ success: false, error: "Invalid email or password." });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    req.session.admin = true;
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Admin login failed");
    res.status(503).json({ success: false, error: "Admin login is unavailable." });
  }
});

router.get("/session", (req, res): void => {
  res.set("Cache-Control", "no-store");
  res.json({ authenticated: req.session.admin === true });
});

router.post("/logout", (req, res): void => {
  res.set("Cache-Control", "no-store");
  req.session.destroy((error) => {
    if (error) {
      req.log.error({ err: error }, "Admin logout failed");
      res.status(503).json({ success: false, error: "Logout failed." });
      return;
    }
    res.clearCookie("tfa_admin", { path: "/" });
    res.json({ success: true });
  });
});

export default router;