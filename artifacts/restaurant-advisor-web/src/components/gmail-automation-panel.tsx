import { useCallback, useEffect, useState } from "react";

type HealthStatus = "healthy" | "degraded" | "error" | "unknown";

interface AutomationHealth {
  checkedAt: string;
  scope: string;
  services: {
    automation: {
      status: HealthStatus;
      detail: string;
    };
  };
}

function isAutomationHealth(value: unknown): value is AutomationHealth {
  if (!value || typeof value !== "object") return false;
  const health = value as AutomationHealth;
  const automation = health.services?.automation;
  return (
    typeof health.checkedAt === "string" &&
    Number.isFinite(Date.parse(health.checkedAt)) &&
    typeof health.scope === "string" &&
    Boolean(automation) &&
    ["healthy", "degraded", "error", "unknown"].includes(automation.status) &&
    typeof automation.detail === "string"
  );
}

const statusColors: Record<HealthStatus, string> = {
  healthy: "#77d28c",
  degraded: "#f0c36a",
  error: "#ff7b7b",
  unknown: "#aaa",
};

export default function GmailAutomationPanel() {
  const [health, setHealth] = useState<AutomationHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/dashboard/system-health", {
        credentials: "include",
        signal,
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const data: unknown = await response.json();
      if (!isAutomationHealth(data)) {
        throw new Error("The backend returned an unexpected response");
      }

      setHealth(data);
    } catch (failure) {
      if (signal?.aborted) return;
      setHealth(null);
      setError(
        failure instanceof Error ? failure.message : "Network or server error",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadHealth(controller.signal);
    return () => controller.abort();
  }, [loadHealth]);

  if (loading) {
    return <p aria-live="polite">Checking automation health…</p>;
  }

  if (error) {
    return (
      <div role="alert" style={{ color: "#ff7b7b", marginTop: 30 }}>
        <p>Error: {error}</p>
        <button type="button" onClick={() => void loadHealth()}>
          Retry
        </button>
      </div>
    );
  }

  if (!health) {
    return <p>No automation health data is available.</p>;
  }

  const automation = health.services.automation;

  return (
    <section
      aria-labelledby="automation-health-title"
      style={{
        marginTop: 30,
        border: "1px solid #303030",
        borderRadius: 10,
        padding: 18,
        background: "#171717",
      }}
    >
      <h2 id="automation-health-title" style={{ marginTop: 0 }}>
        Automation Health
      </h2>
      <p>
        Status:{" "}
        <strong style={{ color: statusColors[automation.status] }}>
          {automation.status}
        </strong>
      </p>
      <p>{automation.detail}</p>
      <p style={{ color: "#aaa", fontSize: 12, marginBottom: 0 }}>
        Checked {new Date(health.checkedAt).toLocaleString()} ·{" "}
        {health.scope.replaceAll("_", " ")}
      </p>
    </section>
  );
}