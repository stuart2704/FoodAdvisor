---
name: Grid crawl activation
description: Why restaurant grid crawling begins with a manual paid run and how to verify it without Google charges.
---

The first billable Google Places grid crawl must be explicitly triggered by the user with confirmation. Once a confirmed point completes, scheduled runs are desired; neither implementation nor verification should silently trigger the first paid run.

**Why:** The user chose manual on the first run, then automatic. They did not authorize billable Google requests for implementation checks. The software's £30/60-request budget is an estimate, not a guaranteed provider invoice ceiling.

**How to apply:** Verify with offline preview and rollback-only reservation simulation. If the first paid run has not happened, leave automation inactive and tell the user how to start it explicitly. Treat provider-side quota/billing controls separately from the software estimate.