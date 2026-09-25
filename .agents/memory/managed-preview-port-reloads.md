---
name: Managed preview port reloads
description: Diagnosing recurring port collisions after environment changes and task merges.
---

After a merge or automatic environment reload, a managed artifact workflow may report a port-in-use failure while an older child of its previous generation continues serving the preview. A successful curl of the port does not establish that the managed workflow is healthy or running current code.

**Why:** Repeated automatic reloads produced this mismatch for the web and API previews; an unqualified restart simply collided with the old listeners.

**How to apply:** Check workflow status, listener ownership, and process ancestry. Stop only the stale development process tree that owns the port, then restart the exact managed artifact workflow once and confirm fresh logs and a response. Do not configure a replacement workflow or change ports to hide the collision.