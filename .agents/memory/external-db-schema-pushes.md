---
name: External database schema pushes
description: Caution around broad schema reconciliation on an existing external PostgreSQL database.
---

An apparently additive schema update can trigger unrelated constraint changes during broad Drizzle schema reconciliation. Never force the broad push to get past a dependency error; use a reviewed, targeted additive migration on the confirmed development database instead.

**Why:** A routine push tried to drop a primary-key constraint depended on by other tables, even though the intended change was only an additional nullable column. Forcing it would risk unrelated data integrity.

**How to apply:** Inspect the actual database target and proposed diff before any schema mutation. For an external production database, do not assume Replit Publish will apply development schema changes; confirm its migration process separately before releasing dependent code.