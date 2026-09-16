import {
  runDailyCycle as runIntegratedDailyCycle,
  type DailyCycleOptions,
  type DailyCycleResult,
} from "../core/integration";

export async function runDailyCycle(
  options: DailyCycleOptions = {},
): Promise<DailyCycleResult> {
  return runIntegratedDailyCycle(options);
}

export default runDailyCycle;