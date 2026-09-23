---
name: Owner contact enrichment boundaries
description: Paid person enrichment is explicit and private; provider submission retries can double-charge.
---

Owner-contact enrichment must remain separate from ordinary restaurant imports and public role-mailbox discovery. Require a supplied real person's identity and company context, explicit budget configuration, and private review-only results.

**Why:** A restaurant name does not identify an owner. Finding a deliverable personal work address does not grant permission for automated outreach or public disclosure.

**How to apply:** Do not infer person names from restaurant names or promote provider results into the public business mailbox or outreach eligibility.

Treat ambiguous BetterContact submissions as potentially charged, not as safe retries.

**Why:** Official BetterContact documentation explicitly says submission POSTs are not idempotent. An `on_hold` request can later resume without resubmission.

**How to apply:** Preserve reservations and request identities across restarts; investigate uncertain submissions instead of sending them again. Provider response custom fields are an array of named entries, unlike the request object.