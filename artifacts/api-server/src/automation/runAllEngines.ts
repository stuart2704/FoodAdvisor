import updateGlobalMetrics from "./globalMetricsEngine";
import outreachEngine from "./outreachEngine";
import { recordHeartbeat } from "../services/engineHeartbeat";

async function runAllEngines(): Promise<void> {
  console.log("Starting combined outreach, automation, and metrics cycle...");
  const failures: unknown[] = [];

  try {
    console.log("Running outreach and automation engine...");
    const outreach = await outreachEngine();
    if (!outreach.success) {
      throw new Error("The outreach and automation cycle reported failures.");
    }
    await Promise.all([
      recordHeartbeat("ai"),
      recordHeartbeat("automation"),
    ]);
    console.log("Outreach and automation engine completed.", {
      status: outreach.status,
      success: outreach.success,
    });
  } catch (error) {
    failures.push(error);
    console.error("Outreach and automation engine failed.", error);
  }

  try {
    console.log("Running global metrics engine...");
    const metrics = await updateGlobalMetrics();
    await recordHeartbeat("queue");
    console.log("Global metrics engine completed.", {
      snapshotId: metrics.id,
      updatedAt: metrics.updatedAt,
    });
  } catch (error) {
    failures.push(error);
    console.error("Global metrics engine failed.", error);
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "One or more engines failed.");
  }

  console.log("All engines completed and reported healthy.");
}

runAllEngines().catch((error) => {
  console.error("Engine run failed.", error);
  process.exitCode = 1;
});