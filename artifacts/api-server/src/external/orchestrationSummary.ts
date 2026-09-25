import { routingStatus } from "./globalRouter";
import { regionSuppressionStatus } from "./regionSuppression";

export function orchestrationSummary() {
  return {
    routing: routingStatus(),
    suppressedRegions: regionSuppressionStatus(),
  };
}