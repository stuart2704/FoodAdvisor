---
name: Temporary ESM test bundles
description: Resolving external packages when test bundles are emitted outside the workspace.
---

When bundling an API route into an ESM test fixture in a temporary directory, leave CommonJS-backed dependencies external but resolve them to their absolute installed path from the test project.

**Why:** Bundling Express into ESM fails on dynamic CommonJS requires, while leaving the bare `express` specifier external fails because Node resolves it relative to the temporary output under `/tmp`, which has no workspace dependencies.

**How to apply:** Resolve external dependencies from the test module's project context before passing their absolute paths into the bundler; avoid relying on temporary output directory package resolution.