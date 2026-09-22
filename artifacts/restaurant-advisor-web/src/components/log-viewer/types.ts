import type { LogEvent } from "../../hooks/useLogStream";

export type Severity = "info" | "warn" | "error";

export interface LogEntry extends LogEvent {
  id: string;
  engine: string;
  severity: Severity;
}