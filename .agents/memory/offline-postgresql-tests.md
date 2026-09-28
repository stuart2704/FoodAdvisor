---
name: Offline PostgreSQL tests
description: Environment-specific startup constraint for temporary local PostgreSQL clusters.
---

Temporary PostgreSQL test clusters must configure a Unix socket directory inside their test-owned temporary directory, even if clients connect over TCP.

**Why:** The PostgreSQL binary here attempts to create a socket lock file under `/run/postgresql` by default, but that directory does not exist. A cluster can therefore fail at startup after successfully binding its TCP address.

**How to apply:** Pass a temporary socket directory to the server's startup options and clean it up with the test cluster. Keep tests independent of application database credentials.

When fixture SQL inserts the same generated identifier into both a UUID column and a text column, use distinct PostgreSQL bind placeholders even if both values are identical.

**Why:** PostgreSQL infers a single type for each placeholder. Reusing one for UUID and text produces an inconsistent-parameter-types error before the integration test reaches the behavior it means to exercise.

**How to apply:** Bind the generated ID twice with separate placeholders rather than relying on an implicit or explicit cast of a shared placeholder.

Temporary tables used with Drizzle inserts must include even columns whose values are emitted as `DEFAULT`; a minimal fixture containing only explicitly assigned fields can fail before the behavior under test.

**Why:** Drizzle's generated INSERT names mapped columns and uses `DEFAULT` expressions for omitted values. PostgreSQL still checks that those named columns exist.

**How to apply:** When creating a throwaway schema for a Drizzle-backed integration test, include every column listed in the generated INSERT, with defaults and constraints needed by the exercised path.