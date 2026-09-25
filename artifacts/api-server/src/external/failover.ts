import { logger } from "../lib/logger";
import { suppressSource } from "./sourceSuppression";

/**
 * Manually suppresses a whole adapter in this process. This does not switch
 * regions or supply an alternate feed and must not be used as a fetch fallback.
 */
export function failover(adapterName: string, region: string) {
  logger.error(
    { adapterName, region },
    "Adapter suppressed in this process; no alternate source configured",
  );
  suppressSource(adapterName);

  return {
    action: "suppressed" as const,
    region,
    adapter: adapterName,
  };
}