---
name: Claim invitations
description: Keep invitation issuance separate from actual pending claim state.
---

An emailed claim invitation must not put the restaurant into a pending-claim state.

**Why:** Storing an invitation-token digest in the existing pending-claim marker would make the outreach eligibility checks exclude the restaurant immediately after Email 1, silently blocking its follow-ups.

**How to apply:** If adding persisted invitation tracking later, keep that lifecycle separate from actual claim attempts. A valid invitation may authorize a claim, but only accepting it should change claim state or cancel outreach.