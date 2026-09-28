import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Log {
  id: string;
  event: string;
  platform: string;
  status: string;
  message?: string | null;
  createdAt: string | null;
}

export function PublishingLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [automation, setAutomation] = useState<boolean | null>(null);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const [data, settingsData] = await Promise.all([
        fetchSocial<{ logs: Log[] }>("/logs"),
        fetchSocial<{ settings: { automation: boolean } }>("/settings").catch(() => null),
      ]);
      setLogs(data.logs);
      setAutomation(settingsData?.settings.automation ?? null);
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
      <h2>Recent Social Events</h2>
        <p style={{ color: "#aaa", fontSize: "0.85rem" }}>Generation, scheduling, publishing attempts and outcomes are recorded here. Token refresh is not reported as active.</p>
      {loading ? <p>Loading logs...</p> : error ? <div className="social-alert">{error}</div> : (
        logs.length === 0 ? <p className="social-empty">{automation === false ? "No social publishing events (automation OFF)." : "No events recorded yet."}</p> : (
          <div className="social-table-wrap">
            <table className="social-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Platform</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Details / provider ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</td>
                    <td>{log.platform}</td>
                    <td>{log.event}</td>
                    <td>
                      <span className={`social-badge ${log.status === "success" ? "published" : log.status === "failed" || log.status === "failure" || log.status === "uncertain" ? "error" : "pending"}`}>
                        {log.status === "failed" ? "failure" : log.status}
                      </span>
                    </td>
                    <td style={{ color: log.status === "failed" || log.status === "uncertain" ? "#ff9b8d" : "inherit" }}>{log.message || "—"}</td>
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
