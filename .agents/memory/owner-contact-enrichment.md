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

Legacy polling timeouts were booked as consumed before provider confirmation; newer timeouts retain their reservation. Preserve this distinction while reconciling old jobs, and require a provider result with matching identity and explicit credit usage before changing either balance.

**Why:** Treating an old provisional debit like a new reservation can debit twice, while releasing an uncertain new request can make a duplicate paid lookup appear affordable.

**How to apply:** When changing reconciliation/accounting, handle both historical timeout accounting and current reserved timeouts; a missing or mismatched provider result is not evidence of zero credits.

Corrections to an already linked provider request must require conclusive identity evidence from both the old and replacement provider records. Empty or pending results are not evidence that the old link was wrong. Keep the existing reservation and use GET only.

**Why:** An admin can mistype a request ID; replacing it on a manual assertion alone could attach another person's private contact or incorrectly settle the credit balance.

**How to apply:** Require an explicit mismatched old identity and a replacement identity bound to the original person, company, domain, and restaurant; reject incomplete records and changes after accounting is settled.