---
name: Manual OSM ingestion policy
description: Why manual city imports must not alter the automatic schedule or claim regional execution.
---

Manual city imports are admin-only, local candidate collection with a per-city 12-hour limit. They must not change the existing all-city automatic ingestion cadence or publish or opt candidates into outreach. A regional routing label is advisory, not evidence that work ran on a cluster.

**Why:** The user explicitly chose to keep the existing all-city schedule while allowing local manual runs until regional hosts are usable. Reporting a selected region as the execution location would misrepresent what happened.

**How to apply:** When extending manual ingestion or its admin controls, keep manual history separate from automatic scheduling, describe actual execution as local, and obtain a new decision before changing the automatic cadence or enabling remote dispatch.