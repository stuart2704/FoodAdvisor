---
name: Stripe environment separation
description: Rules for keeping Premium subscription configuration separate between Stripe test and live modes.
---

The £99 monthly Premium price used during development belongs to Stripe test mode and its price identifier must remain development-only. Never copy that identifier into production or treat a request to connect a live Stripe account as necessary for local testing.

**Why:** Replit provides a Stripe sandbox for safe development. Stripe test and live objects are isolated, so a test price cannot be used by a live account. Connecting live payments is a separate publishing decision.

**How to apply:** Develop and test checkout with the attached sandbox. When the user intentionally enables real payments, create a separate £99 monthly price in the live account and configure the production environment with that live identifier.