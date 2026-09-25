export type ScalingMetrics = {
  queueLength: number;
  cpuUsage: number;
  latency: number;
};

/** Advisory triggers only; does not change deployment replica counts. */
export function scalingTriggers(metrics: ScalingMetrics): ("scale_up" | "scale_down")[] {
  if (
    !Number.isFinite(metrics.queueLength) || metrics.queueLength < 0 ||
    !Number.isFinite(metrics.cpuUsage) || metrics.cpuUsage < 0 || metrics.cpuUsage > 100 ||
    !Number.isFinite(metrics.latency) || metrics.latency < 0
  ) {
    throw new Error("Scaling metrics must contain valid queue length, CPU percentage, and latency.");
  }

  if (metrics.queueLength > 5000 || metrics.cpuUsage > 80 || metrics.latency > 2000) {
    return ["scale_up"];
  }
  if (metrics.queueLength < 500 && metrics.cpuUsage < 40) {
    return ["scale_down"];
  }
  return [];
}