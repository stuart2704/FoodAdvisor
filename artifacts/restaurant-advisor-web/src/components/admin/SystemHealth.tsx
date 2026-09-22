import { useEffect, useMemo, useState } from "react";

type HealthStatus = "healthy" | "degraded" | "error" | "unknown";

interface HealthCheck {
  status: HealthStatus;
  detail: string;
}

interface SystemHealthResponse {
  checkedAt: string;
  scope: "current_process";
  services: {
    ai: HealthCheck;
    automation: HealthCheck;
    queue: HealthCheck;
    api: HealthCheck;
    database: HealthCheck;
  };
}

type EngineStatus = "online" | "offline";

interface EngineHealthResponse {
  ai: { status: EngineStatus };
  automation: { status: EngineStatus };
  queue: { status: EngineStatus };
  api: { status: EngineStatus };
  database: { status: EngineStatus };
}

const serviceLabels: Record<keyof SystemHealthResponse["services"], string> = {
  ai: "AI Engine",
  automation: "Automation",
  queue: "Queue",
  api: "API Layer",
  database: "Database"
};

function isHealthCheck(value: unknown): value is HealthCheck {
  if (!value || typeof value !== "object") return false;
  const check = value as Partial<HealthCheck>;
  return (
    ["healthy", "degraded", "error", "unknown"].includes(check.status ?? "") &&
    typeof check.detail === "string"
  );
}

function isSystemHealth(value: unknown): value is SystemHealthResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<SystemHealthResponse>;
  const services = response.services;
  return (
    typeof response.checkedAt === "string" &&
    Number.isFinite(Date.parse(response.checkedAt)) &&
    response.scope === "current_process" &&
    Boolean(
      services &&
        isHealthCheck(services.ai) &&
        isHealthCheck(services.automation) &&
        isHealthCheck(services.queue) &&
        isHealthCheck(services.api) &&
        isHealthCheck(services.database)
    )
  );
}

function isEngineStatus(value: unknown): value is { status: EngineStatus } {
  if (!value || typeof value !== "object") return false;
  return ["online", "offline"].includes(
    (value as { status?: string }).status ?? ""
  );
}

function isEngineHealth(value: unknown): value is EngineHealthResponse {
  if (!value || typeof value !== "object") return false;
  const health = value as Partial<EngineHealthResponse>;
  return (
    isEngineStatus(health.ai) &&
    isEngineStatus(health.automation) &&
    isEngineStatus(health.queue) &&
    isEngineStatus(health.api) &&
    isEngineStatus(health.database)
  );
}

export function SystemHealth() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [heartbeats, setHeartbeats] = useState<EngineHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | undefined;

    async function loadHealth() {
      if (disposed || pending) return;
      pending = true;
      controller = new AbortController();
      try {
        const options: RequestInit = {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal
        };
        const [healthResponse, heartbeatResponse] = await Promise.all([
          fetch("/dashboard/system-health", options),
          fetch("/health", options)
        ]);
        if (!healthResponse.ok || !heartbeatResponse.ok) {
          throw new Error("Live system health is unavailable.");
        }
        const [healthData, heartbeatData] = (await Promise.all([
          healthResponse.json(),
          heartbeatResponse.json()
        ])) as [unknown, unknown];
        if (!isSystemHealth(healthData) || !isEngineHealth(heartbeatData)) {
          throw new Error("System health returned an unexpected response.");
        }
        if (!disposed) {
          setHealth(healthData);
          setHeartbeats(heartbeatData);
          setError(null);
        }
      } catch (caught) {
        if (
          !disposed &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Live system health is unavailable."
          );
        }
      } finally {
        pending = false;
      }
    }

    void loadHealth();
    const interval = window.setInterval(() => void loadHealth(), 15_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, []);

  const services = health
    ? (Object.entries(health.services) as Array<
        [keyof SystemHealthResponse["services"], HealthCheck]
      >)
    : [];
  const heartbeatEntries = heartbeats
    ? (Object.entries(heartbeats) as Array<
        [keyof EngineHealthResponse, { status: EngineStatus }]
      >)
    : [];
  const summary = useMemo(() => {
    if (!health) return error ? "Checks unavailable" : "Checking services";
    const unhealthy = services.filter(
      ([, check]) => check.status !== "healthy"
    ).length;
    const offline = heartbeatEntries.filter(
      ([, heartbeat]) => heartbeat.status === "offline"
    ).length;
    if (offline > 0) {
      return `${offline} engine${offline === 1 ? "" : "s"} offline`;
    }
    return unhealthy === 0
      ? "All reported checks healthy"
      : `${unhealthy} check${unhealthy === 1 ? "" : "s"} need attention`;
  }, [error, health, heartbeatEntries, services]);

  return (
    <section className="system-health" aria-labelledby="system-health-title">
      <div className="system-health-heading">
        <div>
          <p className="system-health-eyebrow">Operations</p>
          <h2 id="system-health-title">System Health</h2>
        </div>
        <span className="system-health-summary">{summary}</span>
      </div>
      <p className="system-health-description">
        Live, admin-only checks refresh every 15 seconds. Queue status remains
        unknown until real depth telemetry is available.
      </p>
      <ul>
        {health ? (
          services.map(([key, check]) => {
            const heartbeat = heartbeats?.[key]?.status ?? "offline";
            return (
            <li key={key} title={check.detail}>
              <span>{serviceLabels[key]}</span>
              <span className="system-health-states">
                <span className={`system-health-status status-${heartbeat}`}>
                  <span className="system-health-dot" aria-hidden="true" />
                  {heartbeat}
                </span>
                <span className={`system-health-readiness status-${check.status}`}>
                  {check.status}
                </span>
              </span>
            </li>
            );
          })
        ) : (
          <li className="system-health-message">
            {error ?? "Loading system health…"}
          </li>
        )}
      </ul>
      {health && (
        <p className="system-health-updated">
          Checked {new Date(health.checkedAt).toLocaleTimeString()}
        </p>
      )}
    </section>
  );
}