import { useState } from "react";
import type { LogEntry } from "./types";

const tagPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function LogRow({ log, selected, pending, disabled, onSelect, onBookmark, onTags }: {
  log: LogEntry;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onBookmark: (log: LogEntry) => void;
  onTags: (log: LogEntry, tags: string[]) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        time: log.time, type: log.type, message: log.message,
        ...(log.category ? { category: log.category } : {})
      }, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setTagError("Could not copy this event.");
    }
  }

  return (
    <div className={`log-row log-row-${log.severity}`} data-testid={`row-log-${log.id}`}>
      <div className="log-row-controls">
        <label><input type="checkbox" data-testid={`input-select-log-${log.id}`}
          checked={selected} onChange={(event) => onSelect(log.id, event.target.checked)} />
          <span className="sr-only">Select event {log.id}</span></label>
        <button type="button" data-testid={`button-bookmark-log-${log.id}`}
          aria-label={`${log.bookmarked ? "Remove bookmark from" : "Bookmark"} event ${log.id}`}
          aria-pressed={log.bookmarked} disabled={disabled} onClick={() => onBookmark(log)}>
          {log.bookmarked ? "★ Bookmarked" : "☆ Bookmark"}
        </button>
        {pending && <span role="status">Saving…</span>}
      </div>
      <button
        type="button"
        className="log-row-main"
        data-testid={`button-expand-log-${log.id}`}
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
            {log.tags.length > 0 && <span>Tags: {log.tags.join(", ")}</span>}
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
            data-testid={`button-copy-log-${log.id}`}
            onClick={() => void copyLog()}
          >
            {copied ? "Copied" : "Copy event"}
          </button>
          <div className="log-tags">
            <strong>Tags ({log.tags.length}/10)</strong>
            {log.tags.map((tag) => (
              <button key={tag} type="button" disabled={disabled}
                data-testid={`button-remove-tag-${log.id}-${tag}`}
                aria-label={`Remove tag ${tag} from event ${log.id}`}
                onClick={() => void onTags(log, log.tags.filter((item) => item !== tag))}>
                {tag} ×
              </button>
            ))}
            <form onSubmit={(event) => {
              event.preventDefault();
              const tag = tagInput.trim().toLowerCase();
              if (!tagPattern.test(tag)) {
                setTagError("Tag must be 1–32 lowercase letters, numbers, underscores or hyphens, starting with a letter or number.");
              } else if (log.tags.includes(tag)) {
                setTagError("This event already has that tag.");
              } else if (log.tags.length >= 10) {
                setTagError("An event can have up to 10 tags.");
              } else {
                setTagError(null);
                void onTags(log, [...log.tags, tag]).then((saved) => {
                  if (saved) setTagInput("");
                });
              }
            }}>
              <label htmlFor={`tag-${log.id}`}>Add tag</label>
              <input id={`tag-${log.id}`} data-testid={`input-add-tag-${log.id}`}
                value={tagInput} maxLength={32}
                onChange={(event) => { setTagInput(event.target.value); setTagError(null); }}
                placeholder="e.g. follow_up" />
              <button type="submit" disabled={disabled || log.tags.length >= 10 || !tagInput.trim()}
                data-testid={`button-add-tag-${log.id}`}>Add</button>
            </form>
            {tagError && <p role="alert" className="log-action-error">{tagError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}