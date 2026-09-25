import type { Region } from "./globalRouter";

// Configured target names only. Reachability and ownership are not verified,
// and no regional health probe consumes these endpoints yet.
export const clusterEndpoints: Record<Region, string> = {
  eu: "http://eu-cluster.internal/heartbeat",
  us: "http://us-cluster.internal/heartbeat",
  apac: "http://apac-cluster.internal/heartbeat",
};