import updateGlobalMetrics from "./globalMetricsEngine";
import outreachEngine from "./outreachEngine";

async function runAllEngines(): Promise<void> {
  console.log("Starting outreach and automation engine...");
  const outreach = await outreachEngine();
  console.log("Outreach and automation engine completed.", {
    status: outreach.status,
    success: outreach.success,
  });

  console.log("Starting global metrics engine...");
  const metrics = await updateGlobalMetrics();
  console.log("Global metrics engine completed.", {
    snapshotId: metrics.id,
    updatedAt: metrics.updatedAt,
  });

  if (!outreach.success) {
    throw new Error("The outreach and automation cycle completed with failures.");
  }
}

runAllEngines().catch((error) => {
  console.error("Engine run failed.", error);
  process.exitCode = 1;
});