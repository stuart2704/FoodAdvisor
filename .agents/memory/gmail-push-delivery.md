---
name: Gmail Pub/Sub delivery
description: Durable rules that keep Gmail push processing secure and lossless across retries, backlogs, and watch renewals.
---

Authenticate Pub/Sub push with a Google-signed OIDC token bound to the exact canonical audience and expected service-account email.

**Why:** The push endpoint is public by necessity; accepting unsigned notifications would expose Gmail processing to abuse.

**How to apply:** Return 401 for invalid identity. After valid authentication, acknowledge permanently malformed or mismatched notifications with 204 so Pub/Sub does not retry poison messages.

Stage Gmail History message IDs durably before advancing the mailbox history cursor, then drain staged IDs in bounded batches.

**Why:** Gmail backlogs can exceed one request, webhook delivery is duplicated and out of order, and a process can fail after reading history but before classifying replies.

**How to apply:** Store identifiers and processing state only, never message bodies. Keep returning a retryable response while any pending row remains, including rows deferred by backoff. Treat missing watch state as a temporary initialization race.

Only explicit permanent Gmail message responses may be tombstoned.

**Why:** Network, timeout, authentication, quota, rate-limit, and unknown errors are temporary; tombstoning them can silently discard a real restaurant reply after the history cursor has advanced.

**How to apply:** Tombstone known permanent message failures such as 400/404. Leave all other failures pending with retry scheduling.