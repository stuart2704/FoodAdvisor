---
name: Artifact route registration
description: Prevent API endpoints from silently falling through to the root website artifact.
---

Every new top-level API route or exact dashboard endpoint must be included in the API artifact service paths through the validated artifact configuration workflow.

**Why:** When an API path is missing, the root static website can handle the request and return `200` HTML. A status-only check then falsely suggests the API endpoint works.

**How to apply:** After registering a route in Express, register its public path, restart the API workflow, and verify both the status code and JSON content type/body.