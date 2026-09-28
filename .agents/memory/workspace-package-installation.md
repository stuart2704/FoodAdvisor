---
name: Workspace package installation
description: Why a generic package install can fail in this pnpm workspace
---

The generic Node package installer invokes an unscoped `pnpm add` at the workspace root; pnpm rejects this without an explicit root flag. Add a package to its owning workspace package instead.

**Why:** Dependencies must be declared by the artifact that imports them, and the root guard prevents an accidental root dependency.

**How to apply:** When adding an artifact-only package, use a package-scoped installation rather than retrying the generic unscoped command.