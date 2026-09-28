---
name: AI generation lease ownership
description: Why abandoned generation holds use renewable leases and existing-row ownership instead of a new token column.
---

For slow AI generations, extend the reservation while the request is active, and condition final writes or cleanup on the reservation's identity. A late response must never update or delete a replacement hold.

**Why:** A proposed random-token column would have required a schema change to an external database whose migration target was not confirmed; the running API could otherwise start while generation fails on a missing column. An existing creation timestamp is sufficient for ownership because replacement of the same key requires the prior lease to expire first. PostgreSQL's default timestamp precision exceeds JavaScript Date precision, so new holds must explicitly use a JavaScript millisecond timestamp for exact equality checks.

**How to apply:** Preserve the identity check when changing generation or failure paths. If introducing a new column later, verify the external database target and migration rollout before making the API depend on it.