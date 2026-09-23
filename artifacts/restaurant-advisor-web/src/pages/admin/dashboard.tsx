import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import ErrorLogPanel from "../../components/error-log-panel";
import GlobalDirectoryAnalyticsPanel from "../../components/global-directory-analytics-panel";
import GmailAutomationPanel from "../../components/gmail-automation-panel";
import OutreachPanel from "../../components/outreach-panel";
import RestaurantIngestionPanel from "../../components/restaurant-ingestion-panel";
import SummaryPanel from "../../components/summary-panel";

const adminLinks = [
  {
    to: "/admin/performance",
    title: "Performance Metrics",
    description: "Review throughput, success rates, and engine latency.",
  },
  {
    to: "/admin/errors",
    title: "Error Intelligence",
    description: "Inspect recent error classifications by engine.",
  },
  {
    to: "/admin/outreach",
    title: "Outreach Controls",
    description: "Monitor outreach activity and controls.",
  },
  {
    to: "/admin/restaurants",
    title: "Restaurant Ingestion",
    description: "Review and manage restaurant listings.",
  },
] as const;

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ isDev: boolean } | null>(null);
  const [isRunningEngines, setIsRunningEngines] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/status", {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Status request failed.");
        return (await response.json()) as { isDev?: unknown };
      })
      .then((data) => {
        setStatus({ isDev: data.isDev === true });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus(null);
      });

    return () => controller.abort();
  }, []);

  async function startEngines() {
    const confirmed = window.confirm(
      "Run one engine cycle now? This may send eligible outreach emails.",
    );
    if (!confirmed) return;

    setIsRunningEngines(true);
    try {
      const response = await fetch("/dev/run-engines", {
        method: "POST",
        credentials: "include",
      });
      const data = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Engine cycle failed.");
      }
      window.alert(data.message ?? "Engine cycle executed.");
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Engine cycle failed.",
      );
    } finally {
      setIsRunningEngines(false);
    }
  }

  async function logout() {
    await fetch("/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    navigate("/admin/login", { replace: true });
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
            <h1 style={{ margin: "6px 0 0" }}>Dashboard</h1>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            style={{
              padding: "9px 14px",
              border: "1px solid #444",
              borderRadius: "8px",
              background: "#222",
              color: "#eee",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </header>

        {status?.isDev && (
          <div style={{ marginBottom: "20px" }}>
            <div
              role="status"
              style={{
                background: "#f97316",
                color: "#ffffff",
                padding: "10px 16px",
                borderRadius: "8px",
                marginBottom: "12px",
                fontWeight: 600,
              }}
            >
              DEVELOPMENT MODE — Engine runner is enabled
            </div>
            <button
              className="bg-green-600 text-white"
              type="button"
              disabled={isRunningEngines}
              onClick={() => void startEngines()}
            >
              {isRunningEngines ? "Running Engine Cycle…" : "Run Engine Cycle"}
            </button>
          </div>
        )}

        <div style={{ marginBottom: "24px" }}>
          <SummaryPanel />
          <OutreachPanel />
          <GmailAutomationPanel />
          <ErrorLogPanel />
          <RestaurantIngestionPanel />
          <GlobalDirectoryAnalyticsPanel />
        </div>

        <nav
          aria-label="Admin dashboard"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "14px",
          }}
        >
          {adminLinks.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              style={{
                padding: "18px",
                border: "1px solid #303030",
                borderRadius: "10px",
                background: "#171717",
                color: "#eee",
                textDecoration: "none",
              }}
            >
              <strong>{item.title}</strong>
              <span
                style={{
                  display: "block",
                  marginTop: "8px",
                  color: "#999",
                  lineHeight: 1.45,
                }}
              >
                {item.description}
              </span>
            </Link>
          ))}
        </nav>
      </AdminLayout>
    </RequireAdmin>
  );
}