import { logger } from "../lib/logger";
import { recordHeartbeat } from "../services/engineHeartbeat";
import updateGlobalMetrics from "./globalMetricsEngine";
import outreachEngine from "./outreachEngine";

const LOOP_INTERVAL_MS = 10 * 60 * 1000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runEngineCycle(): Promise<void> {
  logger.info("Engine cycle starting");

  const outreach = await outreachEngine();
  if (!outreach.success) {
    throw new Error("The outreach and automation cycle reported failures.");
  }

  await Promise.all([
    recordHeartbeat("ai"),
    recordHeartbeat("automation"),
  ]);

  const metrics = await updateGlobalMetrics();
  await recordHeartbeat("queue");

  logger.info(
    {
      outreachStatus: outreach.status,
      metricsSnapshotId: metrics.id,
    },
    "Engine cycle completed",
  );
}

export async function loopRunner(): Promise<never> {
  logger.info(
    { intervalMs: LOOP_INTERVAL_MS },
    "Starting continuous engine loop",
  );

  while (true) {
    try {
      await runEngineCycle();
    } catch (error) {
      logger.error({ err: error }, "Engine cycle failed");
    }

    logger.info(
      { intervalMs: LOOP_INTERVAL_MS },
      "Engine loop sleeping before next cycle",
    );
    await sleep(LOOP_INTERVAL_MS);
  }
}

const entrypoint = process.argv[1];
const isDirectLoopRunnerExecution =
  typeof entrypoint === "string" &&
  /(?:^|[/\\])loopRunner\.(?:[cm]?[jt]s)$/.test(entrypoint);

if (isDirectLoopRunnerExecution) {
  void loopRunner();
}