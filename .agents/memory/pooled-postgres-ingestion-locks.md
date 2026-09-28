---
name: Pooled PostgreSQL ingestion locks
description: Why long ingestion uses a renewable fenced lease instead of advisory locks through transaction-pooling connections.
---

Use a renewable database lease for external ingestion while fetching. Fence writes with a short database transaction that locks and verifies the current lease owner; never keep a transaction open across remote requests. A released application client is not proof that a session-level lock was released by the same database backend.

**Why:** A production import was rejected while a database backend was idle outside a transaction yet still held the ingestion advisory lock. Transaction pooling can route the unlock call to a different backend, leaving a session lock behind. A transaction-scoped replacement held through a multi-city fetch instead pins a pooled server connection for minutes.

**How to apply:** When changing ingestion coordination, preserve cross-process mutual exclusion and separate manual/automatic cadence. Expiration permits crash recovery, while a token-checked row lock around database writes prevents a stale worker from saving after takeover. An already leaked session lock requires separate, carefully scoped operational cleanup; changing code does not release it.