import { useEffect, useState } from "react";

export interface LogEvent {
  time: string;
  type: string;
  message: string;
  category?: string;
}

class EventFeedError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "EventFeedError";
  }
}

function isLogEvent(value: unknown): value is LogEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<LogEvent>;
  return (
    typeof event.time === "string" &&
    Number.isFinite(Date.parse(event.time)) &&
    typeof event.type === "string" &&
    typeof event.message === "string" &&
    (event.category === undefined || typeof event.category === "string")
  );
}

async function getEvents(signal: AbortSignal): Promise<LogEvent[]> {
  try {
    const response = await fetch("/dashboard/events", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal
    });
    if (response.status === 401 || response.status === 403) {
      throw new EventFeedError("Admin login required.", response.status);
    }
    if (!response.ok) {
      throw new EventFeedError(
        "The event feed is temporarily unavailable.",
        response.status
      );
    }
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || data.length > 200 || !data.every(isLogEvent)) {
      throw new EventFeedError(
        "The event feed returned an unexpected response.",
        response.status
      );
    }
    return data;
  } catch (error) {
    if (
      error instanceof EventFeedError ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    throw new EventFeedError("Could not reach the event feed.", null);
  }
}

export function useLogStream() {
  const [events, setEvents] = useState<LogEvent[]>([]);
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
        const data = await getEvents(controller.signal);
        if (!disposed) {
          setEvents([...data].reverse());
          setError(null);
        }
      } catch (caught) {
        if (!disposed) {
          if (
            caught instanceof EventFeedError &&
            (caught.status === 401 || caught.status === 403)
          ) {
            authBlocked = true;
            setEvents([]);
          }
          setError(
            caught instanceof Error && caught.name !== "AbortError"
              ? caught.message
              : "The event request timed out. Retrying automatically."
          );
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

  return { events, loading, error };
}