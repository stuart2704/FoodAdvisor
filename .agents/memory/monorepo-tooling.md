---
name: Monorepo tooling edge cases
description: Package installer scoping and generated-validator version detection in this workspace.
---

The package-install callback targets the workspace root and can fail with the pnpm root-add guard. Use a package-scoped pnpm operation when that helper cannot express the target package; do not disable the workspace guard or add app dependencies globally.

**Why:** The helper has no working-directory argument, and its default add command was rejected by this monorepo.

**How to apply:** Check the target package manifest and keep app dependencies owned by that package.

Orval's automatic Zod version detection does not reliably interpret workspace catalog references. Keep generation aligned with the runtime's actual Zod major version.

**Why:** Adding integer response schemas exposed generation of Zod 4-only validators against a Zod 3 runtime. Other schemas had hidden the mismatch.

**How to apply:** Set the generator's supported explicit version option for the installed major; regenerate rather than hand-edit generated validators. Reassess that setting during any intentional Zod upgrade.