---
name: External source activation
description: Safety boundary for activating scheduled external candidate adapters.
---

Do not turn example or placeholder provider URLs into live adapters. Activate only verified endpoints with known reuse rights and bounded requests. A configured adapter should fail explicitly on HTTP, timeout, or response-shape errors rather than returning an empty list.

**Why:** External ingestion runs independently on a persisted cadence. Treating a failed provider request as zero candidates would record a successful run and delay retry; calling invented endpoints adds noise and falsely implies a source is integrated.

**How to apply:** Keep unverified source adapters dormant until their real endpoint and license are confirmed. Bound active queries and validate responses before candidate storage. A candidate remains separate from public restaurants and outreach until a promotion policy is implemented.