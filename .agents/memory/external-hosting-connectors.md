---
name: External hosting connectors
description: Provider access rules when the API is deployed outside Replit.
---

Replit connector clients require a Replit identity and cannot authenticate on external hosts such as Render. Provider integrations used at runtime need an explicit direct-credential path outside Replit while retaining the connector path inside Replit.

**Why:** Copying a Replit-hosted application to another platform transfers code but not Replit identity or connector authorization. Startup may succeed while provider-backed functionality remains unavailable.

**How to apply:** Select the direct provider path only when its server-side credential is configured, fail closed when neither path is available, and never commit provider credentials. Keep both paths covered by the same request validation and error handling.