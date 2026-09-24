import { useMemo, useState } from "react";
import { logRequest, useLogHistory, type LogEvent } from "../../hooks/useLogStream";
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

  events.forEach((event) => {
    const severity = toSeverity(event.type);
    const engine = event.category?.trim() || event.type.trim() || "system";
    const minute = event.time.slice(0, 16);
    const key = `${minute}-${engine}-${severity}`;
    const localTime = new Date(event.time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    const log: LogEntry = {
      id: event.id,
      time: event.time,
      type: event.type,
      message: event.message,
      category: event.category,
      bookmarked: event.bookmarked,
      tags: event.tags,
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

interface RowActions {
  selected: string[];
  pendingId: string | null;
  onSelect: (id: string, checked: boolean) => void;
  onBookmark: (log: LogEntry) => void;
  onTags: (log: LogEntry, tags: string[]) => Promise<boolean>;
}

function LogGroupView({ group, actions }: { group: LogGroup; actions: RowActions }) {
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
            <LogRow key={log.id} log={log} selected={actions.selected.includes(log.id)}
              pending={actions.pendingId === log.id} disabled={actions.pendingId !== null} onSelect={actions.onSelect}
              onBookmark={actions.onBookmark} onTags={actions.onTags} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function LogViewer() {
  const [page, setPage] = useState(1);
  const [tag, setTag] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [bookmarked, setBookmarked] = useState(false);
  const { events, hasMore, loading, error, refresh } = useLogHistory({ page, tag, bookmarked });
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
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

  function changePage(next: number) {
    setSelected([]);
    setPage(next);
  }

  async function updateEvent(log: LogEntry, path: string, body: object): Promise<boolean> {
    if (pendingId) return false;
    setPendingId(log.id);
    setActionError(null);
    try {
      await logRequest(path, { id: log.id, ...body });
      setSelected([]);
      refresh();
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not update event.");
      return false;
    } finally {
      setPendingId(null);
    }
  }

  async function exportSelected(format: "csv" | "json") {
    if (!selected.length) return;
    setExporting(true);
    setActionError(null);
    try {
      const response = await logRequest("/export", { ids: selected, format });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `operational-logs.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not export events.");
    } finally {
      setExporting(false);
    }
  }

  const actions: RowActions = {
    selected, pendingId,
    onSelect: (id, checked) => setSelected((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id)),
    onBookmark: (log) => void updateEvent(log, "/bookmark", { bookmarked: !log.bookmarked }),
    onTags: (log, tags) => updateEvent(log, "/tag", { tags })
  };

  return (
    <>
      <div className="log-history-toolbar">
        <strong>Saved history</strong>
        <button type="button" data-testid="button-refresh-logs" disabled={loading || !!pendingId}
          onClick={() => { setSelected([]); refresh(); }}>Refresh</button>
        <span>Page {page} · 50 events per page</span>
      </div>
      <div className="log-history-toolbar">
        <label><input type="checkbox" data-testid="input-bookmarked-only" checked={bookmarked}
          disabled={loading || !!pendingId} onChange={(event) => {
            setBookmarked(event.target.checked); setSelected([]); setPage(1);
          }} /> Bookmarked only</label>
        <form onSubmit={(event) => {
          event.preventDefault();
          const value = tagInput.trim().toLowerCase();
          if (value && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) {
            setFilterError("Use 1–32 lowercase letters, numbers, underscores or hyphens; start with a letter or number.");
            return;
          }
          setFilterError(null); setTag(value); setSelected([]); setPage(1);
        }}>
          <label htmlFor="history-tag-filter">Filter by tag</label>
          <input id="history-tag-filter" data-testid="input-filter-tag" value={tagInput}
            maxLength={32} onChange={(event) => setTagInput(event.target.value)}
            placeholder="Tag name" />
          <button type="submit" disabled={loading || !!pendingId} data-testid="button-apply-tag">Apply</button>
        </form>
        {tag && <button type="button" disabled={loading || !!pendingId} data-testid="button-clear-tag" onClick={() => {
          setTag(""); setTagInput(""); setSelected([]); setPage(1); setFilterError(null);
        }}>Clear tag</button>}
      </div>
      {filterError && <p role="alert" className="log-action-error">{filterError}</p>}
      {actionError && <p role="alert" data-testid="status-log-action-error" className="log-action-error">{actionError}</p>}
      {error && <p role="alert" data-testid="status-log-error" className="log-action-error">{error}</p>}
      <div className="log-filters" aria-label="Log filters">
        <span className="log-filter-note">Search, engine and severity filter this page only.</span>
        <label>
          <span>Engine</span>
          <select
            value={engineFilter}
            data-testid="select-log-engine"
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
            data-testid="select-log-severity"
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
            data-testid="input-search-logs"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search messages"
          />
        </label>
      </div>
      <div className="log-history-toolbar" aria-live="polite">
        <label><input type="checkbox" data-testid="input-select-page" disabled={loading || events.length === 0}
          checked={events.length > 0 && selected.length === events.length}
          onChange={(event) => setSelected(event.target.checked ? events.map((item) => item.id) : [])} />
          Select all on this page</label>
        <span data-testid="status-selected-count">{selected.length} selected</span>
        <button type="button" data-testid="button-export-csv" disabled={!selected.length || loading || exporting || !!pendingId}
          onClick={() => void exportSelected("csv")}>Export CSV</button>
        <button type="button" data-testid="button-export-json" disabled={!selected.length || loading || exporting || !!pendingId}
          onClick={() => void exportSelected("json")}>Export JSON</button>
        {exporting && <span role="status">Preparing export…</span>}
      </div>
      <div
        id="events"
        className="events-box"
        aria-label="Saved operational events, newest first"
        aria-busy={loading}
      >
        {loading ? (
          <p role="status" data-testid="status-logs-loading">Loading saved events…</p>
        ) : error ? (
          <p>Unable to show saved events. <button type="button" onClick={refresh}>Try again</button></p>
        ) : events.length === 0 ? (
          <p data-testid="status-logs-empty">{page > 1 ? "No more events on this page." : "No saved events match these history filters."}</p>
        ) : filteredEvents.length === 0 ? (
          <p>No events on this page match the search filters.</p>
        ) : (
          groups.map((group) => (
            <LogGroupView key={group.key} group={group} actions={actions} />
          ))
        )}
      </div>
      <nav className="log-history-toolbar" aria-label="History pagination">
        <button type="button" data-testid="button-previous-logs" disabled={page === 1 || loading || !!pendingId}
          onClick={() => changePage(page - 1)}>Previous</button>
        <span data-testid="text-log-page">Page {page}</span>
        <button type="button" data-testid="button-next-logs" disabled={!hasMore || loading || !!pendingId}
          onClick={() => changePage(page + 1)}>Next</button>
      </nav>
    </>
  );
}