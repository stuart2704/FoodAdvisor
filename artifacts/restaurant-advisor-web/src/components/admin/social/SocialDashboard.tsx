import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Props {
  onNavigate: (tab: any) => void;
}

export function SocialDashboard({ onNavigate }: Props) {
  const [stats, setStats] = useState({ accounts: 0, posts: 0, schedules: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadStats() {
      try {
        setLoading(true);
        const [accRes, postRes, schedRes] = await Promise.all([
          fetchSocial<{ accounts: any[] }>("/accounts"),
          fetchSocial<{ posts: any[] }>("/posts"),
          fetchSocial<{ schedules: any[] }>("/schedules")
        ]);
        setStats({
          accounts: accRes.accounts.filter(account => account.status === "connected").length,
          posts: postRes.posts.length,
          schedules: schedRes.schedules.filter(schedule => schedule.enabled).length
        });
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  return (
    <div className="social-dashboard">
      <div className="ops-summary-grid" style={{ marginBottom: "24px" }}>
        <article onClick={() => onNavigate("accounts")} style={{ cursor: "pointer" }}>
          <span>Accounts</span>
          <strong>{loading ? "..." : stats.accounts} Connected</strong>
        </article>
        <article onClick={() => onNavigate("schedules")} style={{ cursor: "pointer" }}>
          <span>Schedules</span>
          <strong>{loading ? "..." : stats.schedules} Active</strong>
        </article>
        <article onClick={() => onNavigate("queue")} style={{ cursor: "pointer" }}>
          <span>Post Queue</span>
          <strong>{loading ? "..." : stats.posts} Total Posts</strong>
        </article>
      </div>

      <div className="social-card">
        <h2>System Status</h2>
        <p style={{ color: "#aaa", fontSize: "0.85rem", marginBottom: "16px" }}>
          Facebook Online status and Generator availability are currently unverified without an active probe. Showing resource counts instead.
        </p>
        
        {error && <div className="social-alert">{error}</div>}

        <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "12px", borderBottom: "1px solid #333" }}>
            <span style={{ color: "#aaa" }}>Publishing support</span>
            <span style={{ color: "#eee" }}>Facebook (connection not verified here)</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "12px", borderBottom: "1px solid #333" }}>
            <span style={{ color: "#aaa" }}>Draft / Scheduled Posts</span>
            <span style={{ color: "#eee" }}>{loading ? "..." : stats.posts} tracked</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "12px", borderBottom: "1px solid #333" }}>
            <span style={{ color: "#aaa" }}>Enabled schedules</span>
            <span style={{ color: "#eee" }}>{loading ? "..." : stats.schedules} configured (worker status not verified)</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#aaa" }}>Instagram / TikTok</span>
            <span className="social-badge error">Unavailable</span>
          </div>
        </div>
      </div>
    </div>
  );
}
