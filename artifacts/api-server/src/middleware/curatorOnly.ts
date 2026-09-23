import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export interface CuratorIdentity {
  isAdmin: boolean;
  userId: string;
}

function claimRole(claims: Record<string, unknown>): string | null {
  const directRole = claims.role;
  if (typeof directRole === "string") return directRole;

  for (const key of ["metadata", "public_metadata", "publicMetadata"]) {
    const value = claims[key];
    if (
      typeof value === "object" &&
      value !== null &&
      "role" in value &&
      typeof value.role === "string"
    ) {
      return value.role;
    }
  }

  return null;
}

export function curatorIdentity(req: Request): CuratorIdentity | null {
  if (req.session?.admin) {
    return { isAdmin: true, userId: "admin-session" };
  }

  const auth = getAuth(req);
  if (!auth.userId) return null;
  const role = claimRole((auth.sessionClaims ?? {}) as Record<string, unknown>);
  if (role !== "curator" && role !== "admin") return null;

  return { isAdmin: role === "admin", userId: auth.userId };
}

export function curatorOnly(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.set("Cache-Control", "no-store");
  const identity = curatorIdentity(req);
  if (!identity) {
    res.status(403).json({
      success: false,
      error: "Curator or admin access is required.",
    });
    return;
  }
  res.locals.curator = identity;
  next();
}