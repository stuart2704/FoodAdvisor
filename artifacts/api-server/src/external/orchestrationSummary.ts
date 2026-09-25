import { routingStatus } from "./globalRouter";
import { regionSuppressionStatus } from "./regionSuppression";
import { getRegionHealth } from "./regionHealth";
import { clusterHeartbeat } from "./clusterHeartbeat";

export async function orchestrationSummary() {
  const [eu, us, apac] = await Promise.all([
    clusterHeartbeat("eu"),
    clusterHeartbeat("us"),
    clusterHeartbeat("apac"),
  ]);
  return {
    routing: routingStatus(),
    suppressedRegions: regionSuppressionStatus(),
    health: {
      eu: getRegionHealth("eu"),
      us: getRegionHealth("us"),
      apac: getRegionHealth("apac"),
    },
    clusters: { eu, us, apac },
  };
}