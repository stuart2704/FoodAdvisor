---
name: GitHub push authentication
description: Safe fallback when an attached GitHub OAuth connection works through the API but not through Git CLI.
---

An attached GitHub OAuth connection can have repository write access through the connector while HTTPS Git commands still receive an invalid-token response. Do not force-push, embed credentials in remotes, or ask for tokens in chat.

**Why:** The workspace Git credential bridge may not consume an otherwise healthy connector authorization. Repeated reconnects do not necessarily repair that boundary.

**How to apply:** Confirm the remote branch is an ancestor before writing. If the API fallback is required, update the branch only through a non-force fast-forward and verify the resulting remote tree matches the local tree. Keep local tracking aligned with the remote history afterward.

For a new empty repository, create a temporary initial commit before using Git data endpoints; empty repositories reject blob and ref operations. For large snapshots, create trees one directory at a time from the deepest directories upward because a single flat tree request can time out. Keep connector writes below its request-per-second limit and verify the final root tree SHA against the local Git tree.

Workflow files are a stricter case than ordinary repository content: a healthy GitHub connector with repository write access may still lack the permission to add a GitHub Actions workflow. Do not treat general `repo` access as proof that workflow changes can be pushed, or reconnect when the offered OAuth scopes do not include workflow access.

**Why:** GitHub denied workflow creation despite a healthy connector that could manage Actions variables. Retrying through a different file API did not change the missing permission.

**How to apply:** Check the connector's available reauthorization scopes. An HTML 403 on a workflow-content write may come from an intermediary rather than GitHub, so verify the remote file instead of claiming a permission diagnosis or a successful push. If workflow permission is unavailable, leave the scheduler disabled and ask the repository owner to edit the workflow through an appropriately authorized GitHub session; never bypass the restriction with a force-push.