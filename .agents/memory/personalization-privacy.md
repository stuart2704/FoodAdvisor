---
name: Personalization privacy
description: Constraints for visitor profiles, recommendation ranking, and AI explanations.
---

Personalization requires a client-supplied, consented pseudonymous profile ID. Do not silently create visitor identifiers or store raw search text.

**Why:** Recommendations should improve relevance without building an identifying activity record or exposing private restaurant and owner data.

**How to apply:** Store bounded structured city, cuisine, and price preferences plus restaurant IDs. Keep Premium listings in their ranking tier. Send only aggregate or public fields to AI—never profile IDs, contact details, tokens, payment data, or complete click history.