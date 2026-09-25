---
name: Stripe environment separation
description: Rules for keeping Premium subscription configuration separate between Stripe test and live modes.
---

The £99 monthly Premium price used during development belongs to Stripe test mode and its price identifier must remain development-only. Never copy that identifier into production or treat a request to connect a live Stripe account as necessary for local testing.

**Why:** Replit provides a Stripe sandbox for safe development. Stripe test and live objects are isolated, so a test price cannot be used by a live account. Connecting live payments is a separate publishing decision.

**How to apply:** Develop and test checkout with the attached sandbox. When the user intentionally enables real payments, create a separate £99 monthly price in the live account and configure the production environment with that live identifier.

For this project, the owner explicitly selected the existing live £99 monthly price on the product named “The Food Advisor” rather than the separate live price on “The Food Advisor Premium.” Do not silently switch between the two based on product naming alone.

**Why:** Both live prices meet the API's amount and recurrence checks, but product names do not establish which price the owner wants to sell.

**How to apply:** Preserve the owner's selected live price unless they request a change; verify a new price against the live account before updating production configuration.

Published API processes repeatedly selected the development price because publishing from the main project did not include the isolated task's code. Build logs showed a successful API build, but the published main-project branch still contained the older price selector and manifest. This is not evidence that runtime environment variables are missing.

**Why:** Background task changes are isolated until the task is applied. Rebuilding the main project, even successfully, cannot include unmerged task changes.

**How to apply:** Apply the finished task to the main project, republish, then confirm a new, non-sensitive startup marker from the running API before attempting checkout.