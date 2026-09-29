---
name: External hosting connectors
description: Provider access rules when the API is deployed outside Replit.
---

Replit connector clients require a Replit identity and cannot authenticate on external hosts such as Render. Provider integrations used at runtime need an explicit direct-credential path outside Replit; inside Replit, normally retain the connector path unless the user explicitly chooses otherwise.

**Why:** Copying a Replit-hosted application to another platform transfers code but not Replit identity or connector authorization. Startup may succeed while provider-backed functionality remains unavailable.

**How to apply:** Select the direct provider path only when its server-side credential is configured, fail closed when neither path is available, and never commit provider credentials. Keep both paths covered by the same request validation and error handling.

For Instantly, the user chose a direct project secret even on Replit because the installed API-key connection lacked campaign permissions and the current workspace interface did not allow replacing its credential. The older connection is intentionally retained only for read-only sending-account validation, because the replacement key was created without account-read permission.

**Why:** A working account-read permission on an existing connector did not imply campaign creation permission, and disconnecting the workspace connector risked interrupting other uses. The new key's campaign and email read permissions were confirmed independently without sending.

**How to apply:** Never fall back to the old connector for campaign creation, leads, or sending. Do not treat a new key or a successful read as permission to retry historic failed deliveries automatically; require a separate duplicate-safe review and explicit send approval.

The confirmed Render layout uses separate frontend Static Site and API Web Service entries from the same monorepo, with each service building its package through a pnpm filter from the repository root. Do not set a shortened package folder as Render's Root Directory; external runtime secrets, including a 32+ character session secret, must be configured in the API service.

**Why:** Render successfully deployed with repository-root workspace access, while shortened root paths could not resolve the artifact folders and root skip scripts did not produce package build output.

**How to apply:** Keep service-specific build and start commands even when root build/typecheck scripts are intentionally skipped. Treat successful startup as dependent on external database, auth, payment, and session environment variables being configured in the API service.