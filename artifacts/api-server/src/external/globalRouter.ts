import { logger } from "../lib/logger";

export type Region = "eu" | "us" | "apac";
export type IngestionRegion = Region;

interface RoutingState {
  suppressed: Set<Region>;
  // Records when a region was suppressed, not proof that traffic failed over.
  lastFailover: Record<Region, string | null>;
}

const state: RoutingState = {
  suppressed: new Set(),
  lastFailover: { eu: null, us: null, apac: null },
};

const order: readonly Region[] = ["eu", "us", "apac"];

function assertRegion(region: Region): void {
  if (!order.includes(region)) throw new Error(`Unknown ingestion region: ${region}`);
}

export function suppressRegion(region: Region): void {
  assertRegion(region);
  state.suppressed.add(region);
  state.lastFailover[region] = new Date().toISOString();
  logger.warn({ region }, "Region suppressed in this process; no traffic rerouted");
}

export function isRegionSuppressed(region: Region): boolean {
  assertRegion(region);
  return state.suppressed.has(region);
}

/** Selects a label only; this does not route traffic or verify cluster health. */
export function globalRoute(
  region: Region,
  eligible: (candidate: Region) => boolean = () => true,
): Region {
  assertRegion(region);
  const start = order.indexOf(region);
  for (let offset = 0; offset < order.length; offset++) {
    const candidate = order[(start + offset) % order.length];
    if (isRegionSuppressed(candidate) || !eligible(candidate)) continue;
    if (offset > 0) {
      logger.warn(
        { primary: region, fallback: candidate },
        "Selecting alternate region label; no traffic rerouted",
      );
    }
    return candidate;
  }
  throw new Error("No unsuppressed ingestion region is available.");
}

export function routingStatus(): {
  suppressed: Region[];
  lastFailover: Record<Region, string | null>;
} {
  return {
    suppressed: order.filter((region) => state.suppressed.has(region)),
    lastFailover: { ...state.lastFailover },
  };
}