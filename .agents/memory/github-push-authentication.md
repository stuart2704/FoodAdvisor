---
name: GitHub push authentication
description: Safe fallback when an attached GitHub OAuth connection works through the API but not through Git CLI.
---

An attached GitHub OAuth connection can have repository write access through the connector while HTTPS Git commands still receive an invalid-token response. Do not force-push, embed credentials in remotes, or ask for tokens in chat.

**Why:** The workspace Git credential bridge may not consume an otherwise healthy connector authorization. Repeated reconnects do not necessarily repair that boundary.

**How to apply:** Confirm the remote branch is an ancestor before writing. If the API fallback is required, update the branch only through a non-force fast-forward and verify the resulting remote tree matches the local tree. Keep local tracking aligned with the remote history afterward.

For a new empty repository, create a temporary initial commit before using Git data endpoints; empty repositories reject blob and ref operations. For large snapshots, create trees one directory at a time from the deepest directories upward because a single flat tree request can time out. Keep connector writes below its request-per-second limit and verify the final root tree SHA against the local Git tree.