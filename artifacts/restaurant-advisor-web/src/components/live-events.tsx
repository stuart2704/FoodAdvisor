import { useEffect, useRef, useState } from 'react';

interface EventEntry {
  time: string;
  type: string;
  message: string;
}

function isEvent(value: unknown): value is EventEntry {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<EventEntry>;
  return typeof event.time === 'string' && Number.isFinite(Date.parse(event.time))
    && typeof event.type === 'string' && typeof event.message === 'string';
}

export function LiveEvents() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | undefined;

    async function loadEvents() {
      if (pending || disposed) return;
      pending = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10_000);
      try {
        // This exact root-level endpoint is explicitly routed to the API.
        const response = await fetch('/dashboard/events', {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (response.status === 401 || response.status === 403) {
          setEvents([]);
          throw new Error('Live events require authorised admin access. Browser access has not been configured.');
        }
        if (!response.ok) throw new Error('Could not load live events. Retrying automatically.');
        const data: unknown = await response.json();
        if (!Array.isArray(data) || data.length > 200 || !data.every(isEvent)) {
          throw new Error('The event feed returned an unexpected response.');
        }
        if (!disposed) {
          setEvents(data);
          setError(null);
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error && err.name !== 'AbortError'
            ? err.message : 'The event request timed out. Retrying automatically.');
        }
      } finally {
        window.clearTimeout(timeout);
        pending = false;
        if (!disposed) setLoading(false);
      }
    }

    void loadEvents();
    const interval = window.setInterval(() => void loadEvents(), 3000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [events]);

  return (
    <>
      {error && <p role="status" className="mb-3 text-sm text-destructive">{error}</p>}
      <div id="events" ref={box} className="events-box" role="log" aria-live="polite" aria-label="Live events">
        {loading ? <p>Loading events…</p> : events.length === 0
          ? <p>{error ? 'Event feed unavailable.' : 'No events recorded yet.'}</p>
          : events.map((event, index) => (
            <div
              key={`${event.time}-${index}`}
              className={['success', 'info', 'warning', 'error'].includes(event.type) ? `event-${event.type} break-words` : 'break-words'}
            >
              [{new Date(event.time).toLocaleTimeString()}] {event.message}
            </div>
          ))}
      </div>
      {error && events.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Showing the last successfully loaded events.</p>}
    </>
  );
}