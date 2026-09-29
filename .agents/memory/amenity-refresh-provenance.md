---
name: Amenity refresh provenance
description: Safety boundary for refreshing previously checked venue amenities.
---

Do not infer that a historical completed Google amenity check wrote the restaurant's current amenity tags. A fresh observation may be staged for review, but an existing value can be replaced only when the last checker-applied tags match the value captured at reservation and the live value still matches at review.

**Why:** Historical check rows recorded completion but neither the observed tags nor whether they were actually applied. A restaurant value may have been changed afterward by an owner or operator; completion alone does not establish provenance. A cleared value also must not be treated as a safe blank if a prior checker-applied value existed.

**How to apply:** Keep legacy rows as unknown provenance rather than backfilling an invented applied timestamp. Resolve uncertain existing values outside automatic refresh; ambiguous or failed paid requests are not retried automatically. The application-side budget and quota reservations are not provider invoice guarantees.