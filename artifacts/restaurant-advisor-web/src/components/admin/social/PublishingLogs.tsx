import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Log {
  id: string;
  platform: string;
  status: string;
  message?: string | null;
  createdAt: string | null;
}

export function PublishingLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = async () => {
    try {
      setLoading(true);
      const data = await fetchSocial<{ logs: Log[] }>("/logs");
      setLogs(data.logs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  return (
    <div className="social-card">
      <h2>Social Publishing Logs</h2>
      {loading ? <p>Loading logs...</p> : error ? <div className="social-alert">{error}</div> : (
        logs.length === 0 ? <p className="social-empty">No activity logs.</p> : (
          <div className="social-table-wrap">
            <table className="social-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</td>
                    <td>{log.platform}</td>
                    <td>
                      <span className={`social-badge ${log.status === "success" ? "published" : log.status === "failed" || log.status === "failure" ? "error" : "pending"}`}>
                        {log.status === "failed" ? "failure" : log.status}
                      </span>
                    </td>
                    <td style={{ color: log.status === "failed" || log.status === "failure" ? "#ff9b8d" : "inherit" }}>
                      {(log.status === "failed" || log.status === "failure") ? (log.message || "—") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
