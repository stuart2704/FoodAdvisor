---
name: Pooled PostgreSQL ingestion locks
description: Why ingestion coordination must avoid session-level advisory locks through transaction-pooling connections.
---

Use transaction-scoped advisory locks for ingestion on the pooled PostgreSQL connection, with an explicit transaction that ends on every path. A released application client is not proof that a session-level lock was released by the same database backend.

**Why:** A production import was rejected while a database backend was idle outside a transaction yet still held the ingestion advisory lock. Transaction pooling can route the unlock call to a different backend, leaving a session lock behind.

**How to apply:** When changing ingestion coordination, preserve cross-process mutual exclusion and separate manual/automatic cadence, but do not use session-level advisory locks through the pooled connection. An already leaked session lock requires separate, carefully scoped operational cleanup; changing code does not release it.