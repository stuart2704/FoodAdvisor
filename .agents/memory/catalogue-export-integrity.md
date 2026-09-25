---
name: Catalogue export integrity
description: Why archived restaurant CSV row counts should not be treated as catalogue size.
---

The archived restaurant CSV contains repeated copies of a small catalogue, including repeated header lines. A row count is not a count of unique Google Place IDs.

**Why:** An apparent six-figure historical catalogue proved to contain only the same small set of listings already in the live Neon database. Treating each CSV row as a new listing would misrepresent the catalogue and could disturb live listing state.

**How to apply:** Profile distinct Place IDs, duplicate variations, and malformed/repeated headers before a write. Match the distinct IDs against the intended database; preserve live records on conflict. If a larger catalogue is expected, seek an independently verified source rather than inferring missing records from the repeated CSV.