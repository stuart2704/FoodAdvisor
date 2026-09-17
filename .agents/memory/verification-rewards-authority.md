---
name: Verification and rewards authority
description: Security rules for listing verification and diner reward points.
---

Restaurant verification must be derived from a completed protected owner claim, not changed through a public verification endpoint. Reward balances must be an append-only sum of fixed server-awarded events tied to the authenticated Clerk user.

**Why:** Browser-controlled restaurant IDs, user IDs, verification flags, or point amounts would let unauthenticated callers verify arbitrary listings or grant unlimited rewards.

**How to apply:** Award fixed points only in the same transaction as a verified qualifying action, enforce one award per source action, and expose only the signed-in user's balance. Keep verification separate from Premium billing status.