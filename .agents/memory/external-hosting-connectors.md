---
name: External hosting connectors
description: Provider access rules when the API is deployed outside Replit.
---

Replit connector clients require a Replit identity and cannot authenticate on external hosts such as Render. Provider integrations used at runtime need an explicit direct-credential path outside Replit while retaining the connector path inside Replit.

**Why:** Copying a Replit-hosted application to another platform transfers code but not Replit identity or connector authorization. Startup may succeed while provider-backed functionality remains unavailable.

**How to apply:** Select the direct provider path only when its server-side credential is configured, fail closed when neither path is available, and never commit provider credentials. Keep both paths covered by the same request validation and error handling.

The confirmed Render layout uses separate frontend Static Site and API Web Service entries from the same monorepo, with each service building its package through a pnpm filter from the repository root. Do not set a shortened package folder as Render's Root Directory; external runtime secrets, including a 32+ character session secret, must be configured in the API service.

**Why:** Render successfully deployed with repository-root workspace access, while shortened root paths could not resolve the artifact folders and root skip scripts did not produce package build output.

**How to apply:** Keep service-specific build and start commands even when root build/typecheck scripts are intentionally skipped. Treat successful startup as dependent on external database, auth, payment, and session environment variables being configured in the API service.