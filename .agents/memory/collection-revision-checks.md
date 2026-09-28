---
name: Collection revision checks
description: Why editorial collection writes use revision checks rather than timestamps, and how conflicts should be resolved.
---

Use an atomic numeric revision precondition on every collection mutation, including story changes, lineup replacement, and deletion. Keep a failed editor's draft separate from newly fetched server state until the editor deliberately chooses whether to keep or discard it.

**Why:** PostgreSQL timestamps can have finer precision than serialized JavaScript dates and two edits can share the same millisecond. A read-then-compare check is also unsafe across concurrent writers, especially for the membership replacement that spans multiple statements.

**How to apply:** Claim the revision in the same transaction as membership changes and read the result before committing. If a write loses the claim, return a conflict without changing the lineup. An external production database needs the additive revision migration applied separately before publishing code that selects the column; Replit's managed publish migration does not update external databases.