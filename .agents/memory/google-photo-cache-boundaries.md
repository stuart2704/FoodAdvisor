---
name: Google photo cache boundaries
description: Why temporary Google photo metadata must not be persisted or given a fresh browser TTL on every cache hit.
---

Temporary Places photo metadata and media URIs should be retained only in a short-lived bounded server cache; do not persist them in the diner's browser storage or store image bytes.

**Why:** A full browser max-age assigned to a server cache hit near expiry can keep the provider content around longer than the intended retention window. Browser caching can also bypass a fresh publication/source check after a listing changes. Photo author credits must travel with any cached URI so displaying the image can display its attribution too.

**How to apply:** For new photo consumers, reuse the server's transient lookup path, preserve author attribution, and avoid storing URIs in durable client state. Keep paid lookups behind the existing reservation gate.

For horizontally scaled APIs, use a shared, expiring provider-metadata cache and transaction-scoped per-key coordination, not process-local in-flight promises alone. Keep the short write/prune lock separate from remote provider calls, and prune expired data even when lookups pause.

**Why:** Different API instances can simultaneously reserve and pay for the same photo details and media. Session-level locks can leak through transaction poolers; a transaction-scoped lock releases on failure.

**How to apply:** Confirm the additive cache schema is present before rolling out code that depends on it. Keep publication/source authorization outside the cache and never use a cache hit to bypass per-request checks.

Bound concurrent cache transactions per process below the database pool capacity if the locked work also reserves a paid call through that pool.

**Why:** Otherwise distinct misses can occupy every connection while each waits for another connection to make its budget reservation, deadlocking the entire pool.

**How to apply:** Exercise the real reservation path under pool saturation in concurrency tests; a mock that skips reservation cannot catch this failure.