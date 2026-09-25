import { routingStatus } from "./globalRouter";
import type { Region } from "./globalRouter";

// One process-local region suppression state is shared with globalRouter.
export { suppressRegion, isRegionSuppressed } from "./globalRouter";

export function regionSuppressionStatus(): Region[] {
  return routingStatus().suppressed;
}