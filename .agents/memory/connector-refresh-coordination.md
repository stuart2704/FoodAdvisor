---
name: Connector refresh coordination
description: How to handle connector credential bursts when the provider does not publish a numeric limit.
---

When a connector does not publish a usable rate limit, serialize credential refreshes across API replicas without storing credentials in shared storage; keep brief per-process caches and fail closed if the coordination store is unavailable.

**Why:** Each process's cache reduces request volume but does not prevent synchronized replicas from making concurrent credential calls. Replit documentation did not give a numeric connection-lookup rate limit, so claiming a safe requests-per-minute threshold would be unsupported. A webhook can be retried rather than verifying with an uncoordinated or stale credential.

**How to apply:** Measure the expected volume as one lookup per replica per short cache window, plus bounded 429 retries. Revisit pacing only when a documented or observed limit justifies it. Keep signature verification mandatory and let transient lookup failures return a retryable server error.