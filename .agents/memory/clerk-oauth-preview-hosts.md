---
name: Clerk OAuth preview hosts
description: Host-sensitive verification guidance for Replit-managed Clerk OAuth flows.
---

When Clerk setup uses host-derived publishable-key or proxy behavior, do not treat an OAuth result from an injected automated-testing hostname as authoritative for the actual Replit preview host.

**Why:** A browser tester using an injected Replit hostname received an unavailable-strategy response while the same GitHub OAuth flow succeeded for the user on the normal preview host. The page and code were unchanged; the host context differed.

**How to apply:** Use automated host results to find app bugs, but confirm provider availability and external OAuth redirects on the artifact's actual preview host before concluding that the Auth-pane configuration is broken.