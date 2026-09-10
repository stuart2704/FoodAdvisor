import { useEffect, useState } from 'react';
import { DashboardApiError, getEvents } from '@/lib/dashboard-api';

interface EventEntry {
  time: string;
  type: string;
  message: string;
  category?: string;
}

function isEvent(value: unknown): value is EventEntry {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<EventEntry>;
  return typeof event.time === 'string' && Number.isFinite(Date.parse(event.time))
    && typeof event.type === 'string' && typeof event.message === 'string'
    && (event.category === undefined || typeof event.category === 'string');
}

export function LiveEvents() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let authBlocked = false;
    let controller: AbortController | undefined;

    async function loadEvents() {
      if (pending || disposed || authBlocked) return;
      pending = true;
      controller = new AbortController();
      try {
        const { data } = await getEvents({ signal: controller.signal });
        if (!Array.isArray(data) || data.length > 200 || !data.every(isEvent)) {
          throw new Error('The event feed returned an unexpected response.');
        }
        if (!disposed) {
          setEvents([...data].reverse());
          setError(null);
        }
      } catch (err) {
        if (!disposed) {
          if (err instanceof DashboardApiError && (err.status === 401 || err.status === 403)) {
            authBlocked = true;
            setEvents([]);
          }
          setError(err instanceof Error && err.name !== 'AbortError'
            ? err.message : 'The event request timed out. Retrying automatically.');
        }
      } finally {
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

  return (
    <>
      {error && <p role="status" className="mb-3 text-sm text-destructive">{error}</p>}
      <div id="events" className="events-box" role="log" aria-live="polite" aria-label="Live events, newest first">
        {loading ? <p>Loading events…</p> : events.length === 0
          ? <p>{error ? 'Event feed unavailable.' : 'No events recorded yet.'}</p>
          : events.map((event, index) => (
            <div
              key={`${event.time}-${index}`}
              className={['success', 'info', 'warning', 'error'].includes(event.type) ? `event-${event.type} break-words` : 'break-words'}
            >
              <div className="font-semibold">{event.type.toUpperCase()}{event.category ? ` · ${event.category}` : ''}</div>
              <div>{event.message}</div>
              <time className="text-xs text-muted-foreground" dateTime={event.time}>{new Date(event.time).toLocaleString()}</time>
            </div>
          ))}
      </div>
      {error && events.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Showing the last successfully loaded events.</p>}
    </>
  );
}