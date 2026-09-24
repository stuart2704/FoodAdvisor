/** Only run after 04:00 UTC, and never repeat a day with a reserved grid call. */
export function shouldRunScheduledGridCrawl(
  state: { automation_enabled: boolean; pending_index: number | null; last_run_date: string },
  now: Date,
): boolean {
  const utc = now.toISOString();
  return state.automation_enabled &&
    state.pending_index === null &&
    utc.slice(11, 16) >= "04:00" &&
    state.last_run_date !== utc.slice(0, 10);
}