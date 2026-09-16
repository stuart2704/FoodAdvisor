import {
  runDailyCycle as runIntegratedDailyCycle,
  type DailyCycleOptions,
  type DailyCycleResult,
} from "../core/integration";

export async function runDailyCycle(
  options: DailyCycleOptions = {
    sendOutreach: true,
    sendFollowups: true,
  },
): Promise<DailyCycleResult> {
  return runIntegratedDailyCycle(options);
}

export default runDailyCycle;