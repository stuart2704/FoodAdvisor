/**
 * Compatibility entry point for the single, guarded daily-cycle implementation.
 * Importing this file never starts a cycle or registers a scheduler.
 *
 * Calling without options reads summaries only. Paid imports require explicit
 * cities and confirmation; sending and follow-ups each require their opt-in
 * options plus the existing OUTREACH_ENABLED guard.
 *
 * Maps imports already persist their results: do not queue them for insertion
 * again. Failures propagate to callers rather than being logged as success.
 */
export { runDailyCycle } from "../core/integration";
export type { DailyCycleOptions, DailyCycleResult } from "../core/integration";