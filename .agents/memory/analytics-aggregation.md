---
name: Analytics aggregation
description: Rules for live dashboard totals, historical snapshots, and safe event metadata.
---

Dashboard totals are computed live from restaurant state and immutable events. Scheduled Global Metrics runs write append-only historical snapshots; they are not the authoritative current counters.

**Why:** Mutable singleton counters can drift under concurrent event writes, while append-only events and snapshots remain auditable.

**How to apply:** Add new funnel or commercial metrics to the live aggregation first, then include them in snapshots. Analytics metadata must exclude raw searches, contact details, tokens, visitor identifiers, and other sensitive input.

For Replit-injected Umami custom events on token-bearing or identifying routes, sanitize the tracker payload itself, not just the event data. Umami's ordinary named event call also captures the current URL and page metadata; its payload callback can retain the tracker website ID while replacing those fields with fixed, non-identifying values.

**Why:** A token-free data object still leaks a private route through the event's implicit URL, title, or referrer.

**How to apply:** Use fixed event metadata for sensitive routes and never spread the tracker's original page properties into those events. Treat automatic pageviews as a separate privacy concern.