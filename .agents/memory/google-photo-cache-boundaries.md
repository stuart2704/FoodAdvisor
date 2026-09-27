---
name: Google photo cache boundaries
description: Why temporary Google photo metadata must not be persisted or given a fresh browser TTL on every cache hit.
---

Temporary Places photo metadata and media URIs should be retained only in a short-lived bounded server cache; do not persist them in the diner's browser storage or store image bytes.

**Why:** A full browser max-age assigned to a server cache hit near expiry can keep the provider content around longer than the intended retention window. Browser caching can also bypass a fresh publication/source check after a listing changes. Photo author credits must travel with any cached URI so displaying the image can display its attribution too.

**How to apply:** For new photo consumers, reuse the server's transient lookup path, preserve author attribution, and avoid storing URIs in durable client state. Keep paid lookups behind the existing reservation gate.