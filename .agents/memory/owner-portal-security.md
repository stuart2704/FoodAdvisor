---
name: Owner portal security
description: Security boundaries for restaurant portal access and automated lead escalation.
---

Portal bearer tokens must be cryptographically random, stored only as hashes, expire, and resolve only the associated restaurant's owner-safe listing fields.

**Why:** A token in a portal URL grants restaurant-level access. Plaintext database storage or broad restaurant queries would turn a database or URL leak into wider access.

**How to apply:** Validate tokens server-side on every portal data route, disable caching, and never expose admin, outreach, recipient, or cross-restaurant data.

Automatic pageview analytics must be assessed separately from custom-event payloads when the current URL contains a portal bearer token.

**Why:** Even privacy-safe custom event properties do not prevent an injected pageview tracker from collecting a token-bearing path.

**How to apply:** Before enabling analytics for portal traffic, verify that both pageviews and custom events exclude or safely redact tokenized paths. For owner offer outcomes, use server-side aggregate counts rather than a browser tracker while tokenized paths remain; a safe custom event payload does not make its tracker metadata safe.

For injected website analytics, removing bearer tokens from the path alone is insufficient: the observed tracker includes hashes and query strings in its automatic pageview URL. Normalize incoming owner links synchronously before the injected script executes, then navigate portal sections with token-free URLs. Custom outcome events may supplement server aggregates only with fixed non-identifying tracker metadata.

**Why:** The published proxy adds an async tracker after the HTML head; a React effect or a fragment-only migration would still let it see the bearer token.

**How to apply:** Preserve the early normalization order during HTML or deployment changes, check actual injected tracker behavior with synthetic tokens, and keep authoritative offer counts on the server.

Reply bodies remain transient inputs and are not copied into dashboard storage. Gmail reply recognition must never send mail, including positive-reply escalation. Any separate sending workflow needs its own explicit authorization; Instantly escalation still requires ownership and message-id checks.

**Why:** Raw replies may contain personal or confidential content, and caller-supplied classification requests are not evidence that a restaurant replied. The Gmail recognition request explicitly forbids sending; a trusted positive classification does not override that restriction.

**How to apply:** Dashboard escalation records status and timestamps only. Claim-click and onboarding signals must come from verified claim tokens and successful claim transitions, not arbitrary browser event payloads.