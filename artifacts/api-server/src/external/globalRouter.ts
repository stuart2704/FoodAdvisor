import { logger } from "../lib/logger";
import { isSuppressed } from "./sourceSuppression";
import { regions } from "./regions";

export type IngestionRegion = keyof typeof regions;

const order: IngestionRegion[] = ["eu", "us", "apac"];

/**
 * Selects a region label only. No network request or cross-region transfer
 * occurs here; source suppression and region suppression are distinct keys.
 */
export function globalRoute(region: string): IngestionRegion {
  const primaryIndex = order.indexOf(region as IngestionRegion);
  const start = primaryIndex === -1 ? 0 : primaryIndex;
  const primary = order[start];

  for (let offset = 0; offset < order.length; offset++) {
    const candidate = order[(start + offset) % order.length];
    if (isSuppressed(candidate)) continue;
    if (offset > 0) {
      logger.warn(
        { primary, fallback: candidate },
        "Region suppressed — selecting alternate region label (no traffic routed)",
      );
    }
    return candidate;
  }
  throw new Error("No unsuppressed ingestion region is available.");
}