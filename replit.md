# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

- OSM claim invitations are separate from general outreach. Automatic sending requires production, `OSM_CLAIM_AUTO_INVITES_ENABLED=true`, an individually reviewed high-confidence candidate, and an admin-approved business email with recorded provenance. It never publishes listings. Apply the additive OSM claim-invite migration to the app's database before enabling the scheduler; do not use a broad forced schema push against an external production database.
- Before releasing scheduled OSM retry/status changes against an external production database, apply the additive `lib/db/migrations/0044_external_ingestion_attempt.sql` migration to that confirmed target. Publishing does not migrate an external production database automatically.
- Before relying on chef-photo cleanup after restaurant deletion, apply `lib/db/migrations/0045_chef_photo_cascade_cleanup.sql` to the confirmed database target. It installs cascade cleanup triggers; publishing alone does not install them on external databases.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
