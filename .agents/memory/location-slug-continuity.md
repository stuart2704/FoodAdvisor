---
name: Location slug continuity
description: Why location renames must preserve more than the renamed place's own slug.
---

When a location's canonical slug depends on the full set of names, a rename can also change another location's slug by resolving or creating a collision. Compare the before/after slug maps and preserve all changed URLs, not just the renamed name's URL. Historical aliases must be retargetable when a location returns to an earlier name.

**Why:** Saving only the renamed location's old URL silently loses links for surviving collision partners; inserting an old slug without reusing its existing alias breaks rename-back sequences.

**How to apply:** Any city or region rename or last-restaurant move should be transactional with slug-map snapshots, alias upserts, and tests for collision partners and back-and-forth renames.