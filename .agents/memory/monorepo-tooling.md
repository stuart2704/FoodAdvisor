---
name: Monorepo tooling edge cases
description: Package scoping, generated-validator detection, and standalone build environment requirements.
---

The package-install callback targets the workspace root and can fail with the pnpm root-add guard. Use a package-scoped pnpm operation when that helper cannot express the target package; do not disable the workspace guard or add app dependencies globally.

**Why:** The helper has no working-directory argument, and its default add command was rejected by this monorepo.

**How to apply:** Check the target package manifest and keep app dependencies owned by that package.

Orval's automatic Zod version detection does not reliably interpret workspace catalog references. Keep generation aligned with the runtime's actual Zod major version.

**Why:** Adding integer response schemas exposed generation of Zod 4-only validators against a Zod 3 runtime. Other schemas had hidden the mismatch.

**How to apply:** Set the generator's supported explicit version option for the installed major; regenerate rather than hand-edit generated validators. Reassess that setting during any intentional Zod upgrade.

Standalone artifact builds may require the same routing variables normally supplied by managed workflows. Inspect the artifact's build configuration before retrying a command with guessed defaults.

**Why:** A valid web change passed type checking but standalone Vite builds failed sequentially until both the port and artifact base path expected by the managed environment were supplied.

**How to apply:** Before running an artifact build outside its workflow, identify all required environment inputs from its configuration and provide the artifact's registered preview path as the base path.