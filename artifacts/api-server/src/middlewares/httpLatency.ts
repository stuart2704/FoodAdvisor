import type { RequestHandler } from "express";
import { logEvent } from "../utils/eventLog";

export function sampledHttpEngines(pathname: string): readonly ("api" | "ai")[] {
  if (pathname === "/ai" || pathname.startsWith("/ai/")) return ["ai"];
  if (
    !pathname.startsWith("/api/") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/engine-health") ||
    pathname.startsWith("/api/dashboard/")
  ) return [];
  return pathname === "/api/ai" || pathname.startsWith("/api/ai/")
    ? ["api", "ai"]
    : ["api"];
}

// Sample only numeric timings; no request or response details enter the event.
export const recordSampledHttpLatency: RequestHandler = (req, res, next) => {
  const engines = sampledHttpEngines(req.path);
  if (engines.length === 0 || Math.random() >= 0.1) {
    next();
    return;
  }
  const started = performance.now();
  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode === 404) return;
    const category = res.statusCode >= 500 ? "error" : "success";
    const duration = performance.now() - started;
    for (const engine of engines) {
      logEvent(engine, engine === "ai" ? "Sampled AI HTTP operation completed" : "Sampled HTTP operation completed", category, [], duration);
    }
  });
  next();
};