import {
  createImportPlan,
  getImportStatus,
  runImport,
} from "../lib/restaurant-import";
import { runDailyOutreach } from "../lib/outreach";
import { logEvent } from "../utils/eventLog";

export interface DailyCycleOptions {
  restaurantImport?: {
    cities: string[];
    perCityLimit?: number;
    monthlyBudgetCents?: number;
    // Without confirmation, generate a budget preview without paid requests.
    confirm?: boolean;
  };
  // The existing OUTREACH_ENABLED guard must also allow sending.
  sendOutreach?: boolean;
}

type ImportPlan = Awaited<ReturnType<typeof createImportPlan>>;
type ImportResult = Awaited<ReturnType<typeof runImport>>;
type OutreachResult = Awaited<ReturnType<typeof runDailyOutreach>>;

export interface DailyCycleResult {
  status: "completed" | "completed_with_errors";
  import: { status: "skipped" }
    | { status: "preview"; plan: ImportPlan }
    | {
        status: "completed";
        result: Omit<ImportResult, "restaurants">;
      };
  outreach: { status: "skipped"; reason: string }
    | { status: "completed"; result: OutreachResult };
  replies: { status: "handled_by_pubsub" };
  summary: Awaited<ReturnType<typeof getImportStatus>>;
}

let running = false;

/**
 * Explicitly invoked orchestration only; importing this module starts no work.
 * A no-argument call reads a summary, but does not import or send email.
 * Existing services own insertion, enrichment, templates, deduplication, and
 * status transitions. Gmail replies continue through the durable push receiver.
 */
export async function runDailyCycle(
  options: DailyCycleOptions = {},
): Promise<DailyCycleResult> {
  if (running) throw new Error("A daily cycle is already running in this process.");
  const importOptions = options.restaurantImport;
  const budget = importOptions?.monthlyBudgetCents ?? 2500;
  if (importOptions && (!Number.isInteger(budget) || budget <= 0 || budget > 2500)) {
    throw new Error("Monthly import budget must be between 1 and 2500 pence.");
  }
  if (options.sendOutreach === true && process.env.OUTREACH_ENABLED !== "true") {
    throw new Error("Outreach sending is disabled.");
  }

  running = true;
  let phase = "initialisation";
  logEvent("info", "Daily cycle started");
  try {
    let imported: DailyCycleResult["import"] = { status: "skipped" };
    if (importOptions) {
      phase = "restaurant import";
      const input = {
        cities: importOptions.cities,
        perCityLimit: importOptions.perCityLimit,
        monthlyBudgetCents: budget,
      };
      if (importOptions.confirm === true) {
        logEvent("info", "Restaurant import and insertion started");
        const result = await runImport({ ...input, confirm: true });
        // Return operational counts, not restaurant contact records.
        const { restaurants: _restaurants, ...counts } = result;
        imported = { status: "completed", result: counts };
        logEvent("success", `Restaurant import completed: ${result.imported} inserted`);
      } else {
        imported = { status: "preview", plan: await createImportPlan(input) };
        logEvent("info", "Import preview generated; no paid requests made");
      }
    } else {
      logEvent("info", "Restaurant import skipped: no cities requested");
    }

    let outreach: DailyCycleResult["outreach"] = {
      status: "skipped",
      reason: "Sending was not explicitly requested.",
    };
    if (options.sendOutreach === true) {
      phase = "outreach";
      logEvent("info", "Outreach enrichment, generation, and sending started");
      const result = await runDailyOutreach();
      outreach = { status: "completed", result };
      logEvent(
        result.failed > 0 ? "warning" : "success",
        `Outreach run finished: ${result.sent} sent, ${result.failed} failed`,
      );
    } else {
      logEvent("info", "Outreach sending skipped: not explicitly requested");
    }

    phase = "summary";
    const summary = await getImportStatus();
    const status = outreach.status === "completed" && outreach.result.failed > 0
      ? "completed_with_errors" : "completed";
    logEvent("info", "Replies and their status updates remain handled by Gmail Pub/Sub");
    logEvent(status === "completed" ? "success" : "warning",
      status === "completed" ? "Daily cycle completed" : "Daily cycle completed with outreach errors");
    return { status, import: imported, outreach, replies: { status: "handled_by_pubsub" }, summary };
  } catch {
    // Never publish raw provider errors or report success after a failed phase.
    logEvent("error", `Daily cycle failed during ${phase}`);
    throw new Error(`Daily cycle failed during ${phase}; inspect server diagnostics before retrying.`);
  } finally {
    running = false;
  }
}