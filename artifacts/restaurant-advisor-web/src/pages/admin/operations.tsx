import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import "../../styles/log-viewer.css";
import "../../styles/admin-operations.css";

type ViewKind = "queue" | "engines" | "health";
type LoadState = "loading" | "ready" | "stale" | "error";

const titles: Record<ViewKind, { title: string; description: string }> = {
  queue: {
    title: "Queue",
    description: "Bounded queue totals and safe job identifiers. Job payloads are never returned.",
  },
  engines: {
    title: "Engines",
    description: "Service availability, outcomes, and measured operation latency. Prompts and provider responses are excluded.",
  },
  health: {
    title: "Health",
    description: "Approved readiness and scraper checks, labelled by storage scope.",
  },
};

function Status({ value }: { value: string }) {
  return <span className={`ops-status ops-status-${value}`}>{value}</span>;
}

function QueueView({ data }: { data: any }) {
  const queue = data.queue;
  return <>
    <div className="ops-summary-grid">
      <article><span>Pending</span><strong>{queue.pending}</strong></article>
      <article><span>Capacity</span><strong>{queue.capacity}</strong></article>
      <article><span>Worker</span><strong>{queue.draining ? "Draining" : "Idle"}</strong></article>
    </div>
    <div className="ops-scope">Process-local · resets on restart</div>
    {queue.items.length === 0 ? <div className="ops-empty">No jobs are currently waiting.</div> :
      <div className="ops-table-wrap"><table><thead><tr><th>Job</th><th>Restaurant</th><th>City</th><th>Queued</th></tr></thead>
      <tbody>{queue.items.map((item: any) => <tr key={item.jobId}><td>{item.jobId}</td><td>{item.label}</td><td>{item.city || "—"}</td><td>{item.queuedAt ? new Date(item.queuedAt).toLocaleString() : "Unknown"}</td></tr>)}</tbody></table></div>}
  </>;
}

function EnginesView({ data, stale = false }: { data: any; stale?: boolean }) {
  const latencyLabel = (value: number | null) => value == null ? "—" : `${value.toLocaleString()} ms`;
  const highServices = data.partial ? [] : data.services.filter((service: any) => service.latency.alert?.status === "high");
  const alertLabel = (alert: any) => {
    if (!alert || alert.status === "unavailable") return "Unavailable";
    if (alert.status === "high") return "Sustained high latency";
    if (alert.status === "normal") return "Within threshold";
    return `Insufficient data (${alert.measuredMinutes}/${alert.requiredMinutes} measured minutes)`;
  };
  return <>
    {data.partial && <div className="ops-notice">Availability is current, but recent outcome and latency metrics are temporarily unavailable.</div>}
    {highServices.length > 0 && <div className="ops-latency-warning" role={stale ? undefined : "alert"}>
      {stale ? "Last known alert" : "Sustained high latency"}: {highServices.map((service: any) => service.id).join(", ")}. Each of the last five complete minutes exceeded the configured p95 threshold at the last successful check.
    </div>}
    <div className="ops-card-grid">{data.services.map((service: any) =>
      <article className="ops-card" key={service.id}>
        <div className="ops-card-heading"><h2>{service.id}</h2><Status value={service.availability} /></div>
        <dl><div><dt>Supported</dt><dd>{service.supported ? "Yes" : "No"}</dd></div>
          <div><dt>Recent outcomes</dt><dd>{service.outcomes.total}</dd></div>
          <div><dt>Succeeded / failed</dt><dd>{service.outcomes.succeeded} / {service.outcomes.failed}</dd></div>
          <div><dt>Latency samples</dt><dd>{data.partial ? "Unavailable" : service.latency.samples}</dd></div>
          <div><dt>Average latency</dt><dd>{service.latency.available ? latencyLabel(service.latency.averageMs) : data.partial ? "Unavailable" : service.latency.instrumented ? "No samples in window" : "Not instrumented"}</dd></div>
          <div><dt>95th percentile</dt><dd>{service.latency.available ? latencyLabel(service.latency.p95Ms) : data.partial ? "Unavailable" : "—"}</dd></div>
          <div><dt>Latency alert</dt><dd className={service.latency.alert?.status === "high" && !data.partial ? "ops-alert-high" : ""}>{data.partial ? "Unavailable" : alertLabel(service.latency.alert)}</dd></div></dl>
      </article>)}</div>
    <div className="ops-scope">Availability: durable database heartbeats · outcomes and measured operation latency: last 5 minutes (rolling). API and AI requests are sampled at 10%; automation and queue jobs are measured when completed. Database latency measures completed heartbeat writes, not all queries.</div>
    {!data.partial && data.services[0]?.latency.alert && <div className="ops-scope">
      Alert: p95 above {latencyLabel(data.services[0].latency.alert.thresholdMs)} in each of five complete one-minute buckets, with at least {data.services[0].latency.alert.minimumSamplesPerMinute} measured operations per bucket. Set ENGINE_LATENCY_ALERT_THRESHOLD_MS on the API server to change the threshold.
    </div>}
  </>;
}

function HealthView({ data }: { data: any }) {
  const { readiness, scraper, heartbeats } = data.sections;
  return <>
    <div className="ops-scope-grid">
      <article><strong>Readiness</strong><span>Process-local</span><small>Resets when the API restarts.</small></article>
      <article><strong>Scraper history</strong><span>Process-local</span><small>Recent samples are held in memory.</small></article>
      <article><strong>Engine heartbeats</strong><span>Durable</span><small>{heartbeats.note}</small></article>
    </div>
    <div className="ops-card-grid">{Object.entries(readiness.services).map(([name, check]: [string, any]) =>
      <article className="ops-card" key={name}><div className="ops-card-heading"><h2>{name}</h2><Status value={check.status} /></div><p>{check.detail}</p></article>)}</div>
    <section className="ops-subsection"><h2>Scraper health</h2><p>Today’s score: <strong>{scraper.score ?? "No samples"}</strong></p>
      {scraper.recent.length === 0 && <div className="ops-empty">No scraper health samples are available in this process.</div>}</section>
  </>;
}

export default function AdminOperations({ view }: { view: ViewKind }) {
  const [data, setData] = useState<any>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!data) setState("loading");
    try {
      const response = await fetch(`/dashboard/operations/${view}`, { credentials: "include", cache: "no-store", signal });
      if (response.status === 401) throw new Error("Your admin session has expired. Sign in again.");
      if (!response.ok) throw new Error("This operational view is temporarily unavailable.");
      const next = await response.json();
      setData(next); setState("ready"); setMessage("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState(data ? "stale" : "error");
      setMessage(error instanceof Error ? error.message : "This operational view is unavailable.");
    }
  }, [data, view]);

  useEffect(() => {
    document.title = `${titles[view].title} | The Food Advisor Admin`;
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [view]); // load deliberately refreshes current server state without resetting the interval

  return <RequireAdmin><AdminLayout>
    <header className="ops-header"><div><p>The Food Advisor Admin</p><h1>{titles[view].title}</h1></div>
      <button type="button" onClick={() => void load()}>Refresh</button></header>
    <p className="ops-description">{titles[view].description}</p>
    {state === "loading" && <div className="ops-state">Loading {titles[view].title.toLowerCase()} status…</div>}
    {(state === "error" || state === "stale") && <div className={`ops-state ops-state-${state}`}>{state === "stale" ? "Showing stale data. " : ""}{message}</div>}
    {data && <section className={state === "stale" ? "ops-content is-stale" : "ops-content"}>
      {view === "queue" ? <QueueView data={data} /> : view === "engines" ? <EnginesView data={data} stale={state === "stale"} /> : <HealthView data={data} />}
      <p className="ops-updated">Checked {new Date(data.checkedAt).toLocaleTimeString()}</p>
    </section>}
  </AdminLayout></RequireAdmin>;
}