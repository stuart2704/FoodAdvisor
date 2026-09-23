---
name: Proxy billing boundary
description: Why browser byte limits cannot establish a hard provider charge ceiling
---

Do not equate browser/gateway byte counters with authoritative proxy billing.
Reserve a full verified provider-enforced session charge ceiling before egress;
retain it after failures or ambiguous commits. Keep scanning disabled if that
ceiling cannot be established.

**Why:** Proxy providers may bill buffered upstream traffic, failed requests and
protocol overhead outside the local forwarded-byte counter. An arbitrary safety
multiplier cannot prove a hard financial bound.

**How to apply:** Before changing proxy enablement, pricing or refunds, verify
the actual provider billing/control contract. Public per-GB prices establish a
rate, not a session ceiling. Provider pricing pages may render animated digit
strips; confirm numeric attributes or authoritative account quotes rather than
using the extracted digit sequences as prices.