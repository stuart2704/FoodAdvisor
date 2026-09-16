---
name: Owner portal security
description: Security boundaries for restaurant portal access and automated lead escalation.
---

Portal bearer tokens must be cryptographically random, stored only as hashes, expire, and resolve only the associated restaurant's owner-safe listing fields.

**Why:** A token in a portal URL grants restaurant-level access. Plaintext database storage or broad restaurant queries would turn a database or URL leak into wider access.

**How to apply:** Validate tokens server-side on every portal data route, disable caching, and never expose admin, outreach, recipient, or cross-restaurant data.

Reply bodies remain transient inputs and are not copied into dashboard storage. Lead escalation may act automatically only after the existing Gmail or Instantly ownership and message-id checks have accepted the inbound reply.

**Why:** Raw replies may contain personal or confidential content, and caller-supplied classification requests are not evidence that a restaurant replied.

**How to apply:** Dashboard escalation records status and timestamps only. Claim-click and onboarding signals must come from verified claim tokens and successful claim transitions, not arbitrary browser event payloads.