import { needsDeepCrawl } from "./gridDeepCrawl";
import { hasMissingFields, stalenessReasons } from "./gridStaleness";
import { MONTHLY_PAID_LIMIT } from "./gridCrawlPlan";

export const PRIORITY = {
  DEEP: 3,
  RECOVERY: 2,
  STALE: 1,
  FRESH: 0,
} as const;
export type GridPriority = (typeof PRIORITY)[keyof typeof PRIORITY];

export const BUDGET_CRITICAL = MONTHLY_PAID_LIMIT * 0.90;
export const BUDGET_TIGHT = MONTHLY_PAID_LIMIT * 0.70;
export const BUDGET_COMFORT = MONTHLY_PAID_LIMIT * 0.40;

/**
 * For deciding whether to start separate, additional paid work only.
 * The current grid search is already charged before its results are known.
 */
export function futurePaidWorkSkipReason(
  usedRequests: number,
  priority: GridPriority,
): "paid_budget_exceeded" | "skip_budget_critical" | "skip_budget_tight" | "skip_budget_comfort" | null {
  if (!Number.isSafeInteger(usedRequests) || usedRequests < 0 ||
      !Object.values(PRIORITY).includes(priority)) {
    throw new Error("Invalid paid-request usage or priority.");
  }
  if (usedRequests >= MONTHLY_PAID_LIMIT) return "paid_budget_exceeded";
  if (usedRequests >= BUDGET_CRITICAL && priority < PRIORITY.DEEP) return "skip_budget_critical";
  if (usedRequests >= BUDGET_TIGHT && priority < PRIORITY.RECOVERY) return "skip_budget_tight";
  if (usedRequests >= BUDGET_COMFORT && priority === PRIORITY.FRESH) return "skip_budget_comfort";
  return null;
}

type Existing = Parameters<typeof stalenessReasons>[0] & {
  amenities?: string[] | null;
};
type Incoming = Parameters<typeof stalenessReasons>[1];

/**
 * Informational classification after a grid search, not a reason to make
 * another paid request. Nearby Search cannot supply phone or amenities.
 */
export function classifyGridPriority(existing: Existing, incoming: Incoming, now = new Date()) {
  if (needsDeepCrawl(existing, incoming)) return PRIORITY.DEEP;
  const reasons = stalenessReasons(existing, incoming, now);
  if (hasMissingFields(existing) && reasons.some((reason) => reason.startsWith("missing_"))) {
    return PRIORITY.RECOVERY;
  }
  if (reasons.length) return PRIORITY.STALE;
  return PRIORITY.FRESH;
}