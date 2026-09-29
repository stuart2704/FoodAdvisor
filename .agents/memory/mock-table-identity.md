---
name: Mock table identity
description: Keep fake ORM table identity separate from modeled columns.
---

When mocking an ORM table as a plain object, store the mock table identifier under a reserved property that cannot collide with a modeled column such as `name`.

**Why:** A fake table's `name` metadata was silently overwritten by its `name` column, so a query selected the wrong collection and alert tests saw no candidates without throwing.

**How to apply:** Use a distinct metadata key in fake tables and test the first selected row when diagnosing in-memory DB doubles. This is specific to hand-built test doubles, not a reason to change production schema.