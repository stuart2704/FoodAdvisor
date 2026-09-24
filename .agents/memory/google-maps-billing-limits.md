---
name: Google Maps billing limits
description: Why the app cannot guarantee an exact monthly Google Maps invoice ceiling from its own request ledger.
---

As of September 2026, standard Google Cloud Billing budgets alert rather than stop spending; Google's spend-cap budgets list eligible services that do not include Maps. The app can atomically reserve estimated request costs and stop its own new Places calls, but that does not guarantee a final GBP invoice ceiling.

**Why:** Places SKUs vary by field mask and API, pricing or exchange rates can change, a billing month may differ from the app's UTC window, and other applications or keys may share the Google billing account. A £30 app-side ledger must never be presented as an exact provider billing cap.

**How to apply:** For a literal hard cost requirement, explain the limitation and choose explicitly between disabling billable app calls until provider safeguards are arranged, or using a conservative estimated request limit plus provider-side quotas and billing alerts. Never activate a paid run as a budget verification test.