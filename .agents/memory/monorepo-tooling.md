---
name: Monorepo tooling edge cases
description: Package scoping, generated-validator detection, standalone builds, and Node test bundling.
---

The package-install callback targets the workspace root and can fail with the pnpm root-add guard. Use a package-scoped pnpm operation when that helper cannot express the target package; do not disable the workspace guard or add app dependencies globally.

**Why:** The helper has no working-directory argument, and its default add command was rejected by this monorepo.

**How to apply:** Check the target package manifest and keep app dependencies owned by that package.

For app-local test runners, match the runner's Vite peer compatibility to the artifact's Vite major rather than installing the newest runner indiscriminately.

**Why:** The latest Vitest release loaded a Vite module-runner export that the existing Vite major does not provide; a compatible Vitest major worked without changing the app's build toolchain.

**How to apply:** Check the artifact's Vite version before adding or upgrading Vitest, especially when the package firewall prevents use of an older pin.

After a package-scoped add introduces a new optional peer, workspace links may still point at the old peer variant even when the lockfile expects the new one. Reconcile the workspace from its frozen lockfile before diagnosing widespread type errors.

**Why:** A transitive telemetry dependency changed a shared ORM's peer variant; stale package links made otherwise identical private types incompatible, and a file watcher briefly saw install-time temporary directories.

**How to apply:** If unrelated cross-package type errors appear immediately after a scoped install, compare the resolved peer variants and package symlinks; sync installs from the lockfile and restart any watcher interrupted mid-install.

Orval's automatic Zod version detection does not reliably interpret workspace catalog references. Keep generation aligned with the runtime's actual Zod major version.

**Why:** Adding integer response schemas exposed generation of Zod 4-only validators against a Zod 3 runtime. Other schemas had hidden the mismatch.

**How to apply:** Set the generator's supported explicit version option for the installed major; regenerate rather than hand-edit generated validators. Reassess that setting during any intentional Zod upgrade.

Standalone artifact builds may require the same routing variables normally supplied by managed workflows. Inspect the artifact's build configuration before retrying a command with guessed defaults.

**Why:** A valid web change passed type checking but standalone Vite builds failed sequentially until both the port and artifact base path expected by the managed environment were supplied.

**How to apply:** Before running an artifact build outside its workflow, identify all required environment inputs from its configuration and provide the artifact's registered preview path as the base path.

New routes in the active web shell must not import retired dashboard helpers without first verifying their package dependencies, path aliases, router, and styling runtime.

**Why:** A dormant dashboard component looked reusable but depended on unavailable workspace clients, aliases, icons, and Tailwind styles; making it active surfaced failures one layer at a time.

**How to apply:** Keep small new admin surfaces dependency-local to the active router and authenticated API contract, or explicitly migrate the full dashboard stack as a separate task.

Under Node's strip-types test runner, extensionless local TypeScript imports are not resolved automatically; esbuild ESM bundles of CommonJS dependencies can also throw on dynamic require before tests execute. Keep hermetic test boundaries around unrelated dependencies rather than loosening production checks.

**Why:** An API regression suite failed during module loading despite the behavior under test being unrelated to logging and server middleware.

**How to apply:** When a test harness loads production modules, resolve or mock only unrelated imports in the harness, preserving the actual security and business logic under test.

An artifact-local test command cannot assume another workspace package's TS runner is available as its own Node import hook. Node 24 can strip a directly imported TypeScript route without adding a test dependency when that route has no unresolved local imports.

**Why:** An isolated web smoke check failed at startup when it requested a TS import hook that was available elsewhere in the monorepo, not in the web artifact's package scope.

**How to apply:** Prefer Node's built-in stripping for a simple cross-package TypeScript import; use a package-scoped runner only when the imported module graph requires it.

For one-off database diagnostics in this workspace, use the API package's TS runner rather than plain Node or the DB package's executable context; inline evaluation needs an async function instead of top-level await.

**Why:** Plain Node could not resolve the DB package's TypeScript directory imports, the DB package did not have the runner executable, and inline evaluation used CommonJS transformation.

**How to apply:** Run read-only diagnostic expressions from the API package's executable scope, wrapping awaited queries in an async function and closing the pool when finished.