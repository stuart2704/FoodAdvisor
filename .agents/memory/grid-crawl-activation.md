---
name: Grid crawl activation
description: Why restaurant grid crawling begins with a manual paid run and how to verify it without Google charges.
---

The first billable Google Places grid crawl must be explicitly triggered by the user with confirmation. An earlier preference for scheduling after a confirmed point was superseded by a safety requirement: keep scheduled paid runs disabled until a user-approved monthly limit and the production database target/migration are separately confirmed.

**Why:** The user chose manual on the first run, then automatic, but later required no automatic paid requests without approval of the monthly limit. They did not authorize billable Google requests for implementation checks. The software's £30/60-request budget is an estimate, not a guaranteed provider invoice ceiling.

**How to apply:** Verify with offline preview and rollback-only reservation simulation. Leave automation inactive until the separate approval and production checks are done. Treat provider-side quota/billing controls separately from the software estimate.