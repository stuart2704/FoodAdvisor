---
name: Publishing from task work
description: Navigation and release-order pitfalls when republishing a multi-artifact project during an assigned task.
---

The publishing settings pane shortcut returned “Invalid platform app” for this multi-artifact project even while its existing published build was healthy. Do not infer a deployment failure from that shortcut error.

**Why:** The shortcut did not open Publishing, but the manual Project Editor route remained the appropriate path for the owner to publish. Repeating the shortcut confused the user.

**How to apply:** Direct the user to Project Editor → Tools → Replit Cloud → Publishing (or the editor's top-right Publish control). If the user is looking at an external provider console, first explain that Replit is a different site. Publishing remains user-initiated.

An in-progress task's code may be isolated from the main project version. A user Republish while the task is still in progress can successfully release an older version, even though the local task workspace has the new route.

**Why:** A logged-in request to a newly added readiness route returned 404 after a healthy republish. Replit's task-system documentation says background-task changes join the main project only when the task is applied.

**How to apply:** Do not use an in-progress task's new production-only endpoint as a prerequisite for merging that task. Verify development behavior first, complete/apply the task with any production verification explicitly deferred, and only then ask the owner to republish and perform the live check. Never interpret an unauthenticated 401 from a router-wide guard as proof that a specific route exists.