import { listSuppressedSources } from "./sourceSuppression";
import { getIngestionMetrics } from "./ingestionMetrics";

export async function getIngestionHealth() {
  const metrics = await getIngestionMetrics();
  return {
    suppressedSources: listSuppressedSources(),
    metrics,
  };
}