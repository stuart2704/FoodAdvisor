import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "../../components/admin/AdminLayout";
import ErrorPanel from "../../components/admin/ErrorPanel";
import MetricsPanel from "../../components/admin/MetricsPanel";
import PerformancePanel from "../../components/admin/PerformancePanel";
import { SystemHealth } from "../../components/admin/SystemHealth";
import LogViewer from "../../components/log-viewer/LogViewer";
import "../../styles/log-viewer.css";

export default function AdminLogs() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    document.title = "Operational Logs | The Food Advisor";
    const controller = new AbortController();

    void fetch("/auth/session", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    })
      .then((response) => response.json() as Promise<{ authenticated?: boolean }>)
      .then((session) => {
        if (!session.authenticated) {
          navigate("/admin/login", { replace: true });
          return;
        }
        setAuthenticated(true);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          navigate("/admin/login", { replace: true });
        }
      });

    return () => controller.abort();
  }, [navigate]);

  async function logout() {
    await fetch("/auth/logout", {
      method: "POST",
      credentials: "include"
    });
    navigate("/admin/login", { replace: true });
  }

  if (!authenticated) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        Checking admin access…
      </main>
    );
  }

  return (
    <AdminLayout>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          marginBottom: "24px"
        }}
      >
        <div>
          <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>
            The Food Advisor Admin
          </p>
          <h1 style={{ margin: "6px 0 0" }}>Operational Logs</h1>
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
            cursor: "pointer"
          }}
        >
          Sign out
        </button>
      </header>
      <p style={{ color: "#aaa", marginBottom: "16px" }}>
        Sanitized operational events retained for seven days. The feed refreshes
        every three seconds.
      </p>
      <SystemHealth />
      <MetricsPanel />
      <PerformancePanel />
      <ErrorPanel />
      <LogViewer />
    </AdminLayout>
  );
}