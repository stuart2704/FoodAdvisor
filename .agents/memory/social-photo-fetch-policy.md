---
name: Social photo fetch policy
description: Why Facebook media URLs use a per-post publication gate instead of signed object links.
---

Serve chef images to external social providers through a stable HTTPS endpoint only after an explicit per-post publication approval; keep the underlying object private. Recheck current profile moderation and the exact approved object on each fetch, and allow revocation.

**Why:** Facebook fetches media server-to-server, possibly after the initial publish request. Login-gated private object paths and short-lived signed URLs are not reliable fetch targets; making the entire chef-photo bucket public would expose unrelated private uploads.

**How to apply:** For social media delivery, separate profile moderation from authorization to publish a specific photo. Do not use workspace preview domains as production media URLs; require a configured public origin for the provider fetch URL.