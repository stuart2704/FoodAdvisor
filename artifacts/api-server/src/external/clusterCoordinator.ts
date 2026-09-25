import { globalRoute, type Region } from "./globalRouter";

/** Reports a label-selection decision; no network traffic is routed here. */
export function coordinateCluster(region: Region) {
  const target = globalRoute(region);

  return {
    requested: region,
    routedTo: target,
    isFailover: region !== target,
  };
}