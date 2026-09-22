import { useMemo, useState } from "react";
import { useLogStream, type LogEvent } from "../../hooks/useLogStream";
import { LogRow } from "./LogRow";
import type { LogEntry, Severity } from "./types";

interface LogGroup {
  key: string;
  label: string;
  logs: LogEntry[];
}

function toSeverity(type: string): Severity {
  const normalized = type.toLowerCase();
  if (normalized === "error") return "error";
  if (normalized === "warning" || normalized === "warn") return "warn";
  return "info";
}

function groupLogs(events: LogEvent[]): LogGroup[] {
  const groups = new Map<string, LogGroup>();

  events.forEach((event, index) => {
    const severity = toSeverity(event.type);
    const engine = event.category?.trim() || event.type.trim() || "system";
    const minute = event.time.slice(0, 16);
    const key = `${minute}-${engine}-${severity}`;
    const localTime = new Date(event.time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    const log: LogEntry = {
      ...event,
      id: `${event.time}-${event.type}-${index}`,
      engine,
      severity
    };

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: `${localTime} — ${engine.toUpperCase()} — ${severity.toUpperCase()}`,
        logs: []
      });
    }
    groups.get(key)?.logs.push(log);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    logs: group.logs.sort((a, b) => b.time.localeCompare(a.time))
  }));
}

function LogGroupView({ group }: { group: LogGroup }) {
  const [open, setOpen] = useState(true);

  return (
    <section className="log-group">
      <button
        type="button"
        className="log-group-header"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{group.label}</span>
        <span className="log-group-count">{group.logs.length}</span>
      </button>
      {open && (
        <div className="log-group-body">
          {group.logs.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function LogViewer() {
  const { events, loading, error } = useLogStream();
  const [engineFilter, setEngineFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [search, setSearch] = useState("");
  const engines = useMemo(
    () =>
      Array.from(
        new Set(
          events.map(
            (event) => event.category?.trim() || event.type.trim() || "system"
          )
        )
      ).sort((a, b) => a.localeCompare(b)),
    [events]
  );
  const filteredEvents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return events.filter((event) => {
      const engine = event.category?.trim() || event.type.trim() || "system";
      const severity = toSeverity(event.type);
      const matchesEngine = engineFilter === "all" || engine === engineFilter;
      const matchesSeverity =
        severityFilter === "all" || severity === severityFilter;
      const matchesSearch =
        !query ||
        event.message.toLocaleLowerCase().includes(query) ||
        event.type.toLocaleLowerCase().includes(query) ||
        event.category?.toLocaleLowerCase().includes(query);
      return matchesEngine && matchesSeverity && matchesSearch;
    });
  }, [engineFilter, events, search, severityFilter]);
  const groups = useMemo(() => groupLogs(filteredEvents), [filteredEvents]);

  return (
    <>
      {error && (
        <p role="status" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="log-filters" aria-label="Log filters">
        <label>
          <span>Engine</span>
          <select
            value={engineFilter}
            onChange={(event) => setEngineFilter(event.target.value)}
          >
            <option value="all">All engines</option>
            {engines.map((engine) => (
              <option key={engine} value={engine}>
                {engine}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Severity</span>
          <select
            value={severityFilter}
            onChange={(event) =>
              setSeverityFilter(event.target.value as Severity | "all")
            }
          >
            <option value="all">All severities</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label className="log-search-filter">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search messages"
          />
        </label>
      </div>
      <div
        id="events"
        className="events-box"
        role="log"
        aria-live="polite"
        aria-label="Live events, newest first"
      >
        {loading ? (
          <p>Loading events…</p>
        ) : events.length === 0 ? (
          <p>{error ? "Event feed unavailable." : "No events recorded yet."}</p>
        ) : filteredEvents.length === 0 ? (
          <p>No events match the selected filters.</p>
        ) : (
          groups.map((group) => (
            <LogGroupView key={group.key} group={group} />
          ))
        )}
      </div>
      {error && events.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing the last successfully loaded events.
        </p>
      )}
    </>
  );
}