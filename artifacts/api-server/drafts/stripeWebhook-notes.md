# Stripe webhook — inactive draft

`stripeWebhook.js.txt` preserves the supplied snippet. It is not executable app code, imported, or mounted. Do not restore Stripe dependencies or configuration merely to load this draft.

Before implementation:
- Verify the provider connection, SDK contract, signing secret, and raw-body middleware ordering.
- Treat checkout completion as an event requiring payment/subscription verification, not sufficient proof that a paid entitlement should be activated.
- Match the event to a server-created checkout and stored restaurant/customer/subscription relationship using canonical Google Place IDs. Do not rely solely on metadata or assume subscription metadata matches checkout metadata.
- Verify the expected price, currency, billing interval, subscription status, and live/test environment before granting benefits.
- Store paid entitlement state separately from outreach workflow status; the existing status adapter is not a subscription lifecycle handler.
- Make processing transactional and idempotent, and handle duplicates, retries, and out-of-order events. Cancellation of an old subscription must not revoke a newer valid entitlement.
- Define renewal, payment failure, cancellation, and recovery behavior; preserve the free listing when paid benefits end.
- Avoid logging raw provider errors or sensitive payloads.

These are release prerequisites, not implemented behavior.