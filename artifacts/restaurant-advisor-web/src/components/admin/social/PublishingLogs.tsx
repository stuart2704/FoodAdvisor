import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Log {
  id: string;
  postId: string;
  status?: string;
  message?: string | null;
  createdAt: string;
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
      <h2>Publishing Logs</h2>
      {loading ? <p>Loading logs...</p> : error ? <div className="social-alert">{error}</div> : (
        logs.length === 0 ? <p className="social-empty">No activity logs.</p> : (
          <div className="social-table-wrap">
            <table className="social-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Log ID</th>
                  <th>Post ID</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>{log.id}</td>
                    <td>{log.postId}</td>
                    <td>
                      <span className={`social-badge ${log.status === 'success' || log.status === 'published' ? 'published' : log.status === 'failed' || log.status === 'error' ? 'error' : 'pending'}`}>
                        {log.status || 'unknown'}
                      </span>
                    </td>
                    <td style={{ color: log.message && log.status === "failed" ? "#ff9b8d" : "inherit" }}>
                      {log.message || (log.status === "success" ? "Published" : "—")}
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
