---
name: Discovery ranking policy
description: Product and cost constraints for restaurant search, homepage ranking, and discovery analytics.
---

AI relevance scoring for public search must remain opt-in, use only a small lexical shortlist, validate a bounded numeric response, and degrade to a visible missing value without breaking search. Missing popularity or AI signals contribute zero to ranking but remain distinguishable from measured zero in public data.

**Why:** Public type-ahead search can otherwise trigger unbounded paid AI requests, and fabricated metrics make ranking behavior difficult to audit.

**How to apply:** Keep deterministic filtering before AI, cap scored candidates and concurrency, record AI usage, and never persist raw diner search text or user identifiers in discovery metrics.