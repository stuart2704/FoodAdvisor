import { useState } from "react";
import type { LogEntry } from "./types";

export function LogRow({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyLog() {
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          time: log.time,
          type: log.type,
          message: log.message,
          ...(log.category ? { category: log.category } : {})
        },
        null,
        2
      )
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`log-row log-row-${log.severity}`}>
      <button
        type="button"
        className="log-row-main"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="severity-dot" aria-label={`${log.severity} severity`} />
        <span className="log-row-content">
          <span className="log-row-summary">{log.message}</span>
          <span className="log-row-meta">
            <time dateTime={log.time}>
              {new Date(log.time).toLocaleString()}
            </time>
            <span>{log.engine.toUpperCase()}</span>
          </span>
        </span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <div className="log-row-expansion">
          <dl>
            <dt>Type</dt>
            <dd>{log.type}</dd>
            {log.category && (
              <>
                <dt>Category</dt>
                <dd>{log.category}</dd>
              </>
            )}
            <dt>UTC</dt>
            <dd>{log.time}</dd>
          </dl>
          <button
            type="button"
            className="copy-log-button"
            onClick={() => void copyLog()}
          >
            {copied ? "Copied" : "Copy event"}
          </button>
        </div>
      )}
    </div>
  );
}