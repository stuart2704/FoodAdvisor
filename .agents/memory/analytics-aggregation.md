---
name: Analytics aggregation
description: Rules for live dashboard totals, historical snapshots, and safe event metadata.
---

Dashboard totals are computed live from restaurant state and immutable events. Scheduled Global Metrics runs write append-only historical snapshots; they are not the authoritative current counters.

**Why:** Mutable singleton counters can drift under concurrent event writes, while append-only events and snapshots remain auditable.

**How to apply:** Add new funnel or commercial metrics to the live aggregation first, then include them in snapshots. Analytics metadata must exclude raw searches, contact details, tokens, visitor identifiers, and other sensitive input.