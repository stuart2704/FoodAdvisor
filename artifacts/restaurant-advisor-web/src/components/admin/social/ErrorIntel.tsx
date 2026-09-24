import { useEffect, useState } from "react";
import { fetchSocial } from "./api";

type SocialLog = {
  id: string;
  postId: string | null;
  platform: string;
  status: string;
  message: string | null;
  createdAt: string | null;
  errorType?: string | null;
};

type ErrorSummary = {
  token_error: number;
  permission_error: number;
  rate_limit: number;
  upload_error: number;
  publish_error: number;
  status_error: number;
  unclassified: number;
};

type ErrorResponse = {
  summary: ErrorSummary;
  lastError: SocialLog | null;
  errors: SocialLog[];
};

const categories = [
  { type: "token_error", label: "Token Errors" },
  { type: "permission_error", label: "Permission Errors" },
  { type: "rate_limit", label: "Rate Limits" },
  { type: "upload_error", label: "Upload Errors" },
  { type: "publish_error", label: "Publish Errors" },
  { type: "status_error", label: "Status Errors" },
] as const;

const categoryLabel = (log: SocialLog) =>
  categories.find(item => item.type === log.errorType)?.label ?? "Unclassified";

export function ErrorIntel() {
  const [data, setData] = useState<ErrorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchSocial<ErrorResponse>("/errors"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load publishing errors.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadLogs(); }, []);

  const failures = data?.errors ?? [];
  const lastError = data?.lastError ?? null;

  return (
    <div className="social-card">
      <h2>Error Intelligence</h2>
      <p style={{ color: "#aaa" }}>
        Categories count only recorded provider error types; older or generic failures are unclassified.
        Uncertain publication outcomes require manual review, not an automatic retry.
      </p>
      <button type="button" className="social-btn" onClick={() => void loadLogs()} disabled={loading}>
        Refresh
      </button>
      {error && <div className="social-alert" role="alert">{error}</div>}
      {loading ? <p>Loading errors...</p> : !error && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "18px 0" }}>
            {categories.map(item => (
              <div className="social-card" key={item.type}>
                <div style={{ color: "#aaa" }}>{item.label}</div>
                <strong style={{ fontSize: "1.5rem" }}>{data?.summary[item.type] ?? 0}</strong>
              </div>
            ))}
            <div className="social-card">
              <div style={{ color: "#aaa" }}>Unclassified</div>
              <strong style={{ fontSize: "1.5rem" }}>{data?.summary.unclassified ?? 0}</strong>
            </div>
          </div>
          {lastError && (
            <p className="social-card">
              <strong>Last Error:</strong>{" "}
              {lastError.createdAt ? new Date(lastError.createdAt).toLocaleString() : "Time unknown"}
              {" — "}{lastError.message || "No details recorded"}
              {lastError.postId ? ` (Post ${lastError.postId})` : ""}
            </p>
          )}
          {failures.length === 0 ? <p className="social-empty">No publishing failures recorded.</p> : (
            <div className="social-table-wrap">
              <table className="social-table">
                <thead><tr><th>Time</th><th>Platform</th><th>Post ID</th><th>Category</th><th>Error</th></tr></thead>
                <tbody>
                  {failures.map(log => (
                    <tr key={log.id}>
                      <td>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</td>
                      <td>{log.platform}</td>
                      <td>{log.postId || "—"}</td>
                      <td>{categoryLabel(log)}</td>
                      <td>{log.message || "No details recorded"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}