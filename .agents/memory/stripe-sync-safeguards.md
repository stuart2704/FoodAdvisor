---
name: Stripe sync safeguards
description: Non-obvious packaging and event-order rules for the managed Stripe subscription sync.
---

Keep `stripe-replit-sync` external to the API's esbuild bundle so its runtime-relative SQL migration directory remains available.

**Why:** When bundled, `runMigrations()` can silently skip its missing migration directory, then startup fails later because `stripe.accounts` does not exist.

**How to apply:** Preserve the package in the API build's external list and verify that Stripe schema tables exist after dependency or build changes.

Treat synchronized subscription status as authoritative over Checkout completion when activating restaurant claims.

**Why:** Stripe webhook delivery is asynchronous and may be out of order; a late paid Checkout event must not reactivate a subscription already marked past due, unpaid, or cancelled.

**How to apply:** Checkout reconciliation may activate only when the referenced synchronized subscription is active or trialing; all later lifecycle status changes come from subscription reconciliation.