---
name: Stripe sync lifecycle
description: Pool ownership, endpoint signing secrets, and independent entitlement retries.
---

Treat each fresh StripeSync instance as owning a PostgreSQL pool and close it after use. Select managed signing secrets by account and exact endpoint URL; external hosts use their explicitly configured signing secret.

**Why:** Fresh connector credentials must not cause an unbounded pool leak, and multiple webhook endpoints on one Stripe account have different signing secrets.

**How to apply:** Keep signature verification before any business mutation. Run application entitlement reconciliation even when the Stripe sync package has already deduplicated an event: sync success does not prove the application transaction committed.

Keep stripe-replit-sync external to the server bundle.

**Why:** Its migration runner resolves SQL files relative to its package. Bundling silently changes that path and skips all migrations on a fresh database.

**How to apply:** Check startup logs for actual migration discovery, not only a successful initialization message.