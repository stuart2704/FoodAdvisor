import { useEffect, useState } from "react";

export interface LogEvent {
  id: string;
  time: string;
  type: string;
  message: string;
  category?: string;
  bookmarked: boolean;
  tags: string[];
}

export interface LogFilters {
  page: number;
  tag: string;
  bookmarked: boolean;
}

function isLogEvent(value: unknown): value is LogEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<LogEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.time === "string" &&
    Number.isFinite(Date.parse(event.time)) &&
    typeof event.type === "string" &&
    typeof event.message === "string" &&
    (event.category === undefined || typeof event.category === "string") &&
    typeof event.bookmarked === "boolean" &&
    Array.isArray(event.tags) &&
    event.tags.every((tag) => typeof tag === "string")
  );
}

export async function logRequest(path: string, body: object): Promise<Response> {
  const response = await fetch(`/dashboard/logs${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Admin login required. Sign in again to continue."
        : response.status === 404
          ? "This event is no longer available. Refresh the history."
          : "The request failed. Please try again."
    );
  }
  return response;
}

export function useLogHistory({ page, tag, bookmarked }: LogFilters) {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (tag) params.set("tag", tag);
    if (bookmarked) params.set("bookmarked", "true");
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/dashboard/logs?${params}`, {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(response.status === 401 || response.status === 403
            ? "Admin login required. Sign in again to view history."
            : "Saved log history is unavailable. Please try again.");
        }
        const data: unknown = await response.json();
        if (
          !data || typeof data !== "object" ||
          (data as { success?: unknown }).success !== true ||
          (data as { page?: unknown }).page !== page ||
          typeof (data as { hasMore?: unknown }).hasMore !== "boolean" ||
          !Array.isArray((data as { items?: unknown }).items) ||
          (data as { items: unknown[] }).items.length > 50 ||
          !(data as { items: unknown[] }).items.every(isLogEvent)
        ) {
          throw new Error("Saved log history returned an unexpected response.");
        }
        if (!controller.signal.aborted) {
          setEvents((data as { items: LogEvent[] }).items);
          setHasMore((data as { hasMore: boolean }).hasMore);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setEvents([]);
          setHasMore(false);
          setError(caught instanceof Error ? caught.message : "Could not load saved history.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [page, tag, bookmarked, revision]);

  return {
    events, hasMore, loading, error,
    refresh: () => setRevision((value) => value + 1)
  };
}