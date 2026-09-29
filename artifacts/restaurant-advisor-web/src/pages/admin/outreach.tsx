import { useEffect, useRef, useState } from "react";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";

interface OutreachItem {
  id: number;
  restaurant: string;
  recipientDomain: string | null;
  sentAt: string;
}

interface OutreachRecords {
  success: boolean;
  items: OutreachItem[];
  error?: string;
}

interface OutreachSummary {
  success: boolean;
  totalEvents: number;
  sent: number;
  failed: number;
  error?: string;
}

type ResearchStatus = "all" | "no_business_email" | "extraction_failed";

interface ResearchItem {
  placeId: string;
  name: string;
  city: string;
  website: string | null;
  status: "no_business_email" | "extraction_failed" | string;
  reason: string;
  checkedAt: string | null;
}

interface ResearchResponse {
  success: boolean;
  page: number;
  limit: number;
  total: number;
  summary: {
    noBusinessEmail: number;
    extractionFailed: number;
  };
  items: ResearchItem[];
  error?: string;
}

interface RecheckResponse {
  success: boolean;
  status: string;
  emailFound: boolean;
  error?: string;
}

interface BulkProgress {
  running: boolean;
  phase: "snapshot" | "processing" | "complete" | "failed";
  completed: number;
  total: number;
  failed: number;
  error: string | null;
}

function safeWebsiteUrl(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(website);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export default function AdminOutreach() {
  const [records, setRecords] = useState<OutreachItem[]>([]);
  const [summary, setSummary] = useState<OutreachSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [researchItems, setResearchItems] = useState<ResearchItem[]>([]);
  const [researchSummary, setResearchSummary] = useState<ResearchResponse["summary"] | null>(null);
  const [researchTotal, setResearchTotal] = useState(0);
  const [researchPage, setResearchPage] = useState(1);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus>("all");
  const [researchRevision, setResearchRevision] = useState(0);
  const [researchLoading, setResearchLoading] = useState(true);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [recheckingPlaceId, setRecheckingPlaceId] = useState<string | null>(null);
  const [recheckResults, setRecheckResults] = useState<Record<string, { message: string; error: boolean }>>({});
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const recheckLockRef = useRef(false);
  const bulkRunningRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const options: RequestInit = {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    };
    setError(null);
    void Promise.all([
      fetch("/dashboard/outreach?page=1&limit=50", options),
      fetch("/dashboard/outreach/summary", options),
    ])
      .then(async ([recordsResponse, summaryResponse]) => {
        const recordsData = (await recordsResponse.json()) as OutreachRecords;
        const summaryData = (await summaryResponse.json()) as OutreachSummary;
        if (
          !recordsResponse.ok ||
          !summaryResponse.ok ||
          !recordsData.success ||
          !summaryData.success
        ) {
          throw new Error(
            recordsData.error ??
              summaryData.error ??
              "Outreach activity is unavailable.",
          );
        }
        setRecords(recordsData.items);
        setSummary(summaryData);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Outreach activity is unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    setResearchLoading(true);
    setResearchError(null);
    const query = new URLSearchParams({
      page: String(researchPage),
      limit: "50",
      status: researchStatus,
    });
    void fetch(`/dashboard/outreach/research?${query.toString()}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as ResearchResponse;
        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Website-email research is unavailable.");
        }
        setResearchItems(data.items);
        setResearchSummary(data.summary);
        setResearchTotal(data.total);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setResearchError(
            failure instanceof Error
              ? failure.message
              : "Website-email research is unavailable.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setResearchLoading(false);
      });
    return () => controller.abort();
  }, [researchPage, researchStatus, researchRevision]);

  async function requestRecheck(placeId: string): Promise<RecheckResponse> {
    const response = await fetch(
      `/dashboard/outreach/research/${encodeURIComponent(placeId)}/recheck`,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      },
    );
    const data = (await response.json()) as RecheckResponse;
    if (!response.ok || !data.success) {
      throw new Error(data.error ?? "The research recheck could not be completed.");
    }
    return data;
  }

  function setRecheckResult(placeId: string, result: RecheckResponse) {
    setRecheckResults((current) => ({
      ...current,
      [placeId]: {
        message: result.emailFound
          ? `Recheck complete (${result.status}): qualifying business email found.`
          : `Recheck complete (${result.status}): no qualifying business email found.`,
        error: false,
      },
    }));
  }

  async function recheck(item: ResearchItem) {
    if (recheckLockRef.current || bulkRunningRef.current) return;
    recheckLockRef.current = true;
    setRecheckingPlaceId(item.placeId);
    setRecheckResults((current) => {
      const next = { ...current };
      delete next[item.placeId];
      return next;
    });
    try {
      const result = await requestRecheck(item.placeId);
      setRecheckResult(item.placeId, result);
      setResearchRevision((value) => value + 1);
    } catch (failure: unknown) {
      setRecheckResults((current) => ({
        ...current,
        [item.placeId]: {
          message: failure instanceof Error
            ? failure.message
            : "The research recheck could not be completed.",
          error: true,
        },
      }));
    } finally {
      recheckLockRef.current = false;
      setRecheckingPlaceId(null);
    }
  }

  async function recheckAll() {
    if (bulkRunningRef.current || recheckLockRef.current) return;
    bulkRunningRef.current = true;
    const confirmed = window.confirm(
      "Recheck every restaurant in the currently selected research status across all pages? This only repeats website/email research and sends no immediate email. Any qualifying email found will make that restaurant eligible for the already-enabled outreach scheduler and may send later.",
    );
    if (!confirmed) {
      bulkRunningRef.current = false;
      return;
    }

    setBulkProgress({
      running: true,
      phase: "snapshot",
      completed: 0,
      total: 0,
      failed: 0,
      error: null,
    });
    let snapshotCaptured = false;
    try {
      const getResearchPage = async (page: number) => {
        const query = new URLSearchParams({
          page: String(page),
          limit: "50",
          status: researchStatus,
        });
        const response = await fetch(`/dashboard/outreach/research?${query.toString()}`, {
          credentials: "include",
          cache: "no-store",
        });
        const data = (await response.json()) as ResearchResponse;
        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Could not capture the research list for recheck.");
        }
        return data;
      };

      const firstPage = await getResearchPage(1);
      const snapshot = [...firstPage.items];
      const pageCount = Math.ceil(firstPage.total / firstPage.limit);
      for (let page = 2; page <= pageCount; page += 1) {
        const nextPage = await getResearchPage(page);
        snapshot.push(...nextPage.items);
      }
      const placeIds = [...new Set(snapshot.map((item) => item.placeId))];
      snapshotCaptured = true;
      setBulkProgress({
        running: true,
        phase: "processing",
        completed: 0,
        total: placeIds.length,
        failed: 0,
        error: null,
      });

      let failed = 0;
      for (let index = 0; index < placeIds.length; index += 1) {
        const placeId = placeIds[index];
        setRecheckingPlaceId(placeId);
        setRecheckResults((current) => {
          const next = { ...current };
          delete next[placeId];
          return next;
        });
        try {
          const result = await requestRecheck(placeId);
          setRecheckResult(placeId, result);
        } catch (failure: unknown) {
          failed += 1;
          setRecheckResults((current) => ({
            ...current,
            [placeId]: {
              message: failure instanceof Error
                ? failure.message
                : "The research recheck could not be completed.",
              error: true,
            },
          }));
        }
        setBulkProgress({
          running: true,
          phase: "processing",
          completed: index + 1,
          total: placeIds.length,
          failed,
          error: null,
        });
      }
      setBulkProgress({
        running: false,
        phase: "complete",
        completed: placeIds.length,
        total: placeIds.length,
        failed,
        error: null,
      });
    } catch (failure: unknown) {
      setBulkProgress({
        running: false,
        phase: "failed",
        completed: 0,
        total: 0,
        failed: 0,
        error: failure instanceof Error
          ? failure.message
          : "Could not capture the research list for recheck.",
      });
    } finally {
      bulkRunningRef.current = false;
      recheckLockRef.current = false;
      setRecheckingPlaceId(null);
      if (snapshotCaptured) {
        setResearchRevision((value) => value + 1);
        setRevision((value) => value + 1);
      }
    }
  }

  return (
    <RequireAdmin>
      <AdminLayout>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div>
            <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>
              The Food Advisor Admin
            </p>
            <h1 style={{ margin: "6px 0 0" }}>Outreach Controls</h1>
          </div>
          <button
            type="button"
            onClick={() => {
              setRevision((value) => value + 1);
              setResearchRevision((value) => value + 1);
            }}
            data-testid="button-refresh-outreach"
            style={{
              padding: "9px 14px",
              border: "1px solid #444",
              borderRadius: "8px",
              background: "#222",
              color: "#eee",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "12px",
            marginBottom: "20px",
          }}
          aria-label="Outreach summary"
        >
          {[
            ["Confirmed sends", summary?.sent],
            ["Failed sends", summary?.failed],
            ["All audit events", summary?.totalEvents],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                padding: "16px",
                border: "1px solid #303030",
                borderRadius: "10px",
                background: "#171717",
              }}
            >
              <span style={{ color: "#999", fontSize: "0.8rem" }}>
                {label}
              </span>
              <strong
                style={{
                  display: "block",
                  marginTop: "8px",
                  fontSize: "1.5rem",
                }}
              >
                {typeof value === "number" ? value.toLocaleString() : "—"}
              </strong>
            </div>
          ))}
        </section>

        <section
          aria-labelledby="website-email-research-heading"
          style={{
            marginTop: "32px",
            padding: "20px",
            border: "1px solid #303030",
            borderRadius: "10px",
            background: "#171717",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "16px",
              flexWrap: "wrap",
              marginBottom: "16px",
            }}
          >
            <div>
              <h2 id="website-email-research-heading" style={{ margin: "0 0 8px" }}>
                Website-email research
              </h2>
              <p style={{ color: "#aaa", margin: 0, maxWidth: "760px" }}>
                Restaurants without a qualifying business email, or where website
                extraction failed. Recheck only repeats website/email research: it does not
                immediately send outreach or trigger a paid import. If an address is found,
                the restaurant becomes eligible for the existing outreach scheduler.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: "6px", color: "#aaa", fontSize: "0.9rem" }}>
                Status
                <select
                  data-testid="select-research-status"
                  value={researchStatus}
                  disabled={bulkProgress?.running}
                  onChange={(event) => {
                    setResearchPage(1);
                    setResearchStatus(event.target.value as ResearchStatus);
                  }}
                  style={{
                    minWidth: "190px",
                    padding: "9px 10px",
                    border: "1px solid #444",
                    borderRadius: "8px",
                    background: "#222",
                    color: "#eee",
                  }}
                >
                  <option value="all">All research issues</option>
                  <option value="no_business_email">No business email</option>
                  <option value="extraction_failed">Extraction failed</option>
                </select>
              </label>
              <button
                type="button"
                data-testid="button-recheck-all"
                disabled={
                  researchLoading ||
                  researchTotal === 0 ||
                  recheckingPlaceId !== null ||
                  bulkProgress?.running === true
                }
                onClick={() => void recheckAll()}
                style={{
                  padding: "9px 12px",
                  border: "1px solid #444",
                  borderRadius: "8px",
                  background: "#222",
                  color: "#eee",
                  cursor:
                    researchLoading ||
                    researchTotal === 0 ||
                    recheckingPlaceId !== null ||
                    bulkProgress?.running
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    researchLoading ||
                    researchTotal === 0 ||
                    recheckingPlaceId !== null ||
                    bulkProgress?.running
                      ? 0.65
                      : 1,
                }}
              >
                {bulkProgress?.running
                  ? "Rechecking all…"
                  : `Recheck all ${researchTotal} listed`}
              </button>
            </div>
          </div>

          {bulkProgress ? (
            <p
              role={bulkProgress.phase === "failed" ? "alert" : "status"}
              data-testid="status-recheck-all-progress"
              style={{
                color: bulkProgress.phase === "failed" ? "#ff9b8d" : "#9bd4a7",
                margin: "0 0 16px",
              }}
            >
              {bulkProgress.phase === "snapshot"
                ? "Capturing the initial list across all pages before rechecking."
                : bulkProgress.phase === "processing"
                  ? `Rechecking ${bulkProgress.completed} of ${bulkProgress.total}; ${bulkProgress.failed} partial failures.`
                  : bulkProgress.phase === "complete"
                    ? `Finished rechecking ${bulkProgress.total} restaurants from the initial snapshot; ${bulkProgress.failed} partial failures.`
                    : bulkProgress.error}
            </p>
          ) : null}

          <div
            aria-label="Website-email research summary"
            style={{ display: "flex", gap: "20px", flexWrap: "wrap", color: "#aaa", marginBottom: "16px" }}
          >
            <span data-testid="text-research-no-business-email">
              No business email: {researchSummary?.noBusinessEmail.toLocaleString() ?? "—"}
            </span>
            <span data-testid="text-research-extraction-failed">
              Extraction failed: {researchSummary?.extractionFailed.toLocaleString() ?? "—"}
            </span>
          </div>

          {researchError ? (
            <p role="alert" data-testid="status-research-error" style={{ color: "#ff9b8d" }}>
              {researchError}
            </p>
          ) : researchLoading ? (
            <p role="status" data-testid="status-research-loading" style={{ color: "#aaa" }}>
              Loading website-email research…
            </p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    textAlign: "left",
                    minWidth: "860px",
                  }}
                >
                  <thead>
                    <tr>
                      {["Restaurant", "City", "Website", "Status", "Reason", "Last checked", "Action"].map((heading) => (
                        <th key={heading} style={{ padding: "12px", borderBottom: "1px solid #333" }}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {researchItems.map((item) => {
                      const websiteUrl = safeWebsiteUrl(item.website);
                      const result = recheckResults[item.placeId];
                      return (
                        <tr key={item.placeId} data-testid={`row-research-${item.placeId}`}>
                          <td style={{ padding: "12px" }}>{item.name}</td>
                          <td style={{ padding: "12px", color: "#aaa" }}>{item.city || "—"}</td>
                          <td style={{ padding: "12px" }}>
                            {websiteUrl ? (
                              <a
                                href={websiteUrl}
                                target="_blank"
                                rel="noreferrer"
                                data-testid={`link-research-website-${item.placeId}`}
                                style={{ color: "#ff9d68" }}
                              >
                                {item.website}
                              </a>
                            ) : (
                              <span style={{ color: "#aaa" }}>{item.website || "—"}</span>
                            )}
                          </td>
                          <td style={{ padding: "12px", color: "#aaa" }}>
                            {item.status === "no_business_email" ? "No business email" : "Extraction failed"}
                          </td>
                          <td style={{ padding: "12px", color: "#aaa" }}>{item.reason || "—"}</td>
                          <td style={{ padding: "12px", color: "#aaa" }}>
                            {item.checkedAt ? new Date(item.checkedAt).toLocaleString() : "Never"}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <button
                              type="button"
                              data-testid={`button-recheck-${item.placeId}`}
                              disabled={recheckingPlaceId !== null || bulkProgress?.running === true}
                              onClick={() => void recheck(item)}
                              style={{
                                padding: "8px 11px",
                                border: "1px solid #444",
                                borderRadius: "8px",
                                background: "#222",
                                color: "#eee",
                                cursor:
                                  recheckingPlaceId !== null || bulkProgress?.running
                                    ? "not-allowed"
                                    : "pointer",
                                opacity:
                                  recheckingPlaceId !== null || bulkProgress?.running
                                    ? 0.65
                                    : 1,
                              }}
                            >
                              {recheckingPlaceId === item.placeId ? "Rechecking…" : "Recheck"}
                            </button>
                            {result ? (
                              <p
                                role={result.error ? "alert" : "status"}
                                data-testid={`status-recheck-${item.placeId}`}
                                style={{ color: result.error ? "#ff9b8d" : "#9bd4a7", margin: "8px 0 0", minWidth: "180px" }}
                              >
                                {result.message}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {researchItems.length === 0 ? (
                <p data-testid="text-research-empty" style={{ padding: "16px", color: "#999" }}>
                  No restaurants match this research status.
                </p>
              ) : null}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginTop: "16px",
                  color: "#aaa",
                }}
              >
                <span data-testid="text-research-pagination">
                  Page {researchPage} of {Math.max(1, Math.ceil(researchTotal / 50))}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    data-testid="button-research-previous"
                    disabled={researchPage <= 1}
                    onClick={() => setResearchPage((page) => Math.max(1, page - 1))}
                    style={{ padding: "8px 11px", border: "1px solid #444", borderRadius: "8px", background: "#222", color: "#eee", cursor: researchPage <= 1 ? "not-allowed" : "pointer" }}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    data-testid="button-research-next"
                    disabled={researchPage >= Math.ceil(researchTotal / 50)}
                    onClick={() => setResearchPage((page) => page + 1)}
                    style={{ padding: "8px 11px", border: "1px solid #444", borderRadius: "8px", background: "#222", color: "#eee", cursor: researchPage >= Math.ceil(researchTotal / 50) ? "not-allowed" : "pointer" }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {error ? (
          <p role="alert" style={{ color: "#ff9b8d" }}>
            {error}
          </p>
        ) : (
          <section
            style={{
              overflowX: "auto",
              border: "1px solid #303030",
              borderRadius: "10px",
              background: "#171717",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
              }}
            >
              <thead>
                <tr>
                  {["Restaurant", "Recipient domain", "Sent"].map((heading) => (
                    <th
                      key={heading}
                      style={{ padding: "12px", borderBottom: "1px solid #333" }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td style={{ padding: "12px" }}>{record.restaurant}</td>
                    <td style={{ padding: "12px", color: "#aaa" }}>
                      {record.recipientDomain ?? "—"}
                    </td>
                    <td style={{ padding: "12px", color: "#aaa" }}>
                      {new Date(record.sentAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 ? (
              <p style={{ padding: "16px", color: "#999" }}>
                No confirmed outreach sends found.
              </p>
            ) : null}
          </section>
        )}
      </AdminLayout>
    </RequireAdmin>
  );
}