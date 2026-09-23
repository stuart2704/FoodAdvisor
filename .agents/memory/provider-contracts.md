---
name: Provider contract verification
description: Why connector examples and credential assumptions need runtime verification before controlling provider workflows.
---

Verify operationally important provider fields against current official endpoint documentation, not just the connector's setup example. Use representative provider fixtures in tests.

**Why:** Instantly's connector example suggested a lead field that was unsuitable for reliable email direction/ownership checks. Its sequence delay was also easy to interpret as waiting before the current message rather than before the next message. Tests based only on our own assumptions initially passed despite those errors.

**How to apply:** When changing provider integrations, independently verify sender/recipient identity, event timestamps, pagination, and delay semantics before relying on them for suppression, delivery confirmation, or scheduling. Keep uncertain behavior disabled rather than claiming live verification from mocked tests.

Stripe connector credential fields and sync-package defaults must be verified against the live runtime contract.

**Why:** The live Stripe connector used `settings.secret` rather than the older `settings.secret_key` example and returned separate environment records. `stripe-replit-sync` also defaults `syncBackfill()` to no useful object selection unless `{ object: "all" }` is passed.

**How to apply:** Select the exact runtime environment without fallback, validate the configured Price against Stripe, use one webhook-secret ownership model, and pass `{ object: "all" }` for a full backfill.