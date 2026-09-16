import type { NextFunction, Request, Response } from "express";

export function adminOnly(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.set("Cache-Control", "no-store");
  if (req.session?.admin) return next();
  res.status(401).json({ success: false, error: "Admin login required" });
}