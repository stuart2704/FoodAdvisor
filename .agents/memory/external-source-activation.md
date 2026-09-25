---
name: External source activation
description: Safety boundary for activating scheduled external candidate adapters.
---

Do not turn example or placeholder provider URLs into live adapters. Activate only verified endpoints with known reuse rights and bounded requests. A configured adapter should fail explicitly on HTTP, timeout, or response-shape errors rather than returning an empty list.

**Why:** External ingestion runs independently on a persisted cadence. Treating a failed provider request as zero candidates would record a successful run and delay retry; calling invented endpoints adds noise and falsely implies a source is integrated.

**How to apply:** Keep unverified source adapters dormant until their real endpoint and license are confirmed. Bound active queries and validate responses before candidate storage. A candidate remains separate from public restaurants and outreach until a promotion policy is implemented.

Public Overpass requests must remain small and paced. Limiting output to 100 elements does not make a country-wide bounding-box query cheap: the server must still evaluate the broad geographic search. Country extents are reference data, not safe single-query inputs.

**Why:** The user expanded city coverage while also suggesting one query per country; direct country-wide queries would likely time out or burden the shared public service.

**How to apply:** Keep scheduled public Overpass queries to bounded city-sized boxes with pacing. Use an appropriately licensed bulk dataset or a separately designed incremental import for national coverage.

Process-local suppression sets are only temporary operational filters, not durable source disablement or restaurant opt-outs. A future work queue must acknowledge an item after successful handling, not remove it before promotion and risk losing it on failure.

**Why:** Scheduled ingestion may restart or run on multiple servers, and a failed batch must remain recoverable without silently advancing success state.

**How to apply:** Use persisted source state for automatic circuit breaking and the existing restaurant database suppression fields for outreach. If adding a worker, choose a durable queue with leases or equivalent retry semantics.