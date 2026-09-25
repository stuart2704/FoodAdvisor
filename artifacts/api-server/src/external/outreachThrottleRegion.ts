import type { Region } from "./globalRouter";

/** Suggested delay in minutes only; does not authorize or schedule outreach. */
export function outreachThrottleRegion(region: Region, priority: number): number {
  if (!Number.isFinite(priority) || priority < 0) {
    throw new Error("Outreach priority must be a non-negative finite number.");
  }

  if (region === "eu") {
    return priority >= 80 ? 1 : priority >= 60 ? 5 : priority >= 40 ? 20 : 60;
  }
  if (region === "us") {
    return priority >= 80 ? 1 : priority >= 60 ? 10 : priority >= 40 ? 30 : 90;
  }
  if (region === "apac") {
    return priority >= 80 ? 2 : priority >= 60 ? 8 : priority >= 40 ? 25 : 70;
  }
  throw new Error(`Unknown outreach region: ${region}`);
}