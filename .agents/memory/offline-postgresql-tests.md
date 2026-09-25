---
name: Offline PostgreSQL tests
description: Environment-specific startup constraint for temporary local PostgreSQL clusters.
---

Temporary PostgreSQL test clusters must configure a Unix socket directory inside their test-owned temporary directory, even if clients connect over TCP.

**Why:** The PostgreSQL binary here attempts to create a socket lock file under `/run/postgresql` by default, but that directory does not exist. A cluster can therefore fail at startup after successfully binding its TCP address.

**How to apply:** Pass a temporary socket directory to the server's startup options and clean it up with the test cluster. Keep tests independent of application database credentials.