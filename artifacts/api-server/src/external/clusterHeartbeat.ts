import type { Region } from "./globalRouter";
import { clusterEndpoints } from "./clusterEndpoints";

/** A bounded reachability check; network errors are not proof of remote outage. */
export async function clusterHeartbeat(region: Region): Promise<{
  region: Region;
  connected: boolean;
  status: "healthy" | "offline" | "unknown";
}> {
  const url = clusterEndpoints[region];
  if (!url) throw new Error(`Unknown cluster region: ${region}`);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    return {
      region,
      connected: response.ok,
      status: response.ok ? "healthy" : response.status >= 500 ? "offline" : "unknown",
    };
  } catch {
    return { region, connected: false, status: "unknown" };
  }
}