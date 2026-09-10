export interface LogEvent {
  time: string;
  type: string;
  message: string;
}

// Process-local diagnostics only: do not include credentials or message bodies.
const events: LogEvent[] = [];

export function logEvent(type: string, message: string): void {
  events.push({
    time: new Date().toISOString(),
    type,
    message,
  });

  if (events.length > 200) events.shift();
}

export function getEvents(): LogEvent[] {
  // Readers must not be able to mutate the stored log.
  return events.map((event) => ({ ...event }));
}