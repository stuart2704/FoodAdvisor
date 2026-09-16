export type SchedulerRunOutcome = "completed" | "failed" | "skipped";

export interface SchedulerRun {
  id: number;
  scheduler: string;
  startedAt: string;
  completedAt: string;
  outcome: SchedulerRunOutcome;
  message: string;
}

const runs: SchedulerRun[] = [];
let nextId = 1;

export function recordSchedulerRun(
  scheduler: string,
  startedAt: Date,
  outcome: SchedulerRunOutcome,
  message: string,
): void {
  runs.push({
    id: nextId++,
    scheduler,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    outcome,
    message,
  });
  if (runs.length > 100) runs.shift();
}

export function getSchedulerRuns(limit: number): SchedulerRun[] {
  return runs.slice(-limit).reverse().map((run) => ({ ...run }));
}