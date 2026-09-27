# Restaurant grid crawler

The checked-in `coordinates.json` contains 10 verified grid points for London and 10 for New York. Each paid Google Places Nearby Search returns at most 10 restaurants. No missing city coordinates are invented. This crawler creates or refreshes restaurant listings; it cannot reconstruct the original database.

## Run it

From the workspace root:

```bash
node crawler/index.js
```

That is an **offline preview** of the 20-point plan. It does not connect to the database or Google. To inspect an older progress file in offline mode, pass `--state /path/to/progress.json`; this file is never the paid cursor. For a database-backed budget check that rolls its sample reservation back and **does not call Google**, use `node crawler/index.js --plan --monthly-budget-cents 1000`.

To start the **first billable run manually**, use:

```bash
node crawler/index.js --confirm --monthly-budget-cents 1000
```

Every paid run is manual. The `--monthly-budget-cents` argument (50–3000) is required and becomes the saved estimated monthly limit on the first reservation. Later runs must use that same value; a different value fails closed rather than increasing the allowance. Completion leaves the cursor at the grid length, without wrapping or activating a paid schedule. Do not set `NODE_ENV=production` just to run the local crawler. The script reads `GOOGLE_MAPS_API_KEY` and the application's configured PostgreSQL connection; do not put keys in this file or the command line.

The schedule is disabled. `node crawler/index.js --pause` also leaves its stored automation flag off without making a paid request. A currently running crawler holds a lock; if pausing reports that it is busy, wait for that run to finish and retry.

The crawler allows at most 50 attempted grid requests per UTC day, spaces requests by 15 seconds, and checks a **60-request / £30 estimated monthly ceiling** including other import-ledger activity. It reserves an estimated 50 pence in the import ledger *before* each Google call. These are software estimates, **not guaranteed Google invoice limits**: actual pricing and other Google usage can differ. Configure a suitable provider-side quota and monitor billing as well.

The separate Places Search Text importer now uses the same database row lock and reserves each billable call in the shared import ledger before contacting Google. Its paid `/api/restaurant-import/run` route requires an admin session.

## Durable state and recovery

Confirmed runs use the singleton `crawler_progress` database row as the authoritative grid hash, next point, UTC daily count, and pending point. They hold a transaction-scoped PostgreSQL advisory lock so concurrent runners do not claim the same point. A database transaction reserves the global ledger entry and the correct region/city monthly counters together before a request. A point advances only after the provider response and all listing writes finish. A changed grid, conflicting cursor, or uncertain pending request stops the runner rather than restarting at point zero. `--state` is only for older offline previews and is rejected for paid runs. An existing default `grid-progress.json` blocks initial paid activation: reconcile any older paid progress with the import ledger and database before removing the legacy file; do not reset it to zero and repeat calls.

If a request or a write fails after a reservation, that point stays pending and automatic runs stop. Inspect the provider response and the ledger before deciding what to do. To **skip** the uncertain point without requesting it again, deliberately run:

```bash
node crawler/index.js --skip-uncertain --confirm
```

Its estimated reservation remains counted. Skipping can leave that point's restaurant data incomplete. Do not delete the import-ledger row or reset the cursor to retry it.

## Region and city budgets

Each run derives scores from existing restaurant records for the cities in the validated grid:

- `popularity`: average stored restaurant popularity, bounded to 0–1.
- `density`: city listing count divided by the largest city listing count in this grid.
- `missing_fields_rate`: average fraction missing website, price level, cuisine, or address.
- `stale_rate`: fraction with no `updated_at` or an update older than 60 days.

A city with no listings deliberately receives `(0, 0, 1, 1)`, so a new city is not excluded. Legacy listings without a global region count only when the city maps unambiguously to one grid location. City and region weights use `0.4 × popularity + 0.3 × density + 0.2 × missing_fields_rate + 0.1 × stale_rate`. The older three-factor score on optional city objects in a grid file is informational and does **not** replace this budget score.

The 60-request ceiling is divided among supplied regions by their weights, then each region's allowance among all its cities; shares are floored and rounding remainders remain unallocated. Budgets are frozen within each UTC month. On a new month, the runner changes only the matching region/city rows to the new month and resets their month-scoped usage in the same transaction as the next reservation. It never clears all usage with an unrestricted `UPDATE`. Global estimated spending is still checked against the import ledger before every request.

`region_progress` stores a separate monthly budget, usage, interval, and next-due date for each grid region. A completed region is due again after `round(7 - score × 6)` days (1–7), if an operator explicitly starts another manual run. The runner skips regions that are not due; a region blocked by its city, region, daily, or global monthly allowance makes no paid request. `city_progress` stores each `(region_name, city_name)` budget and used count, and `city_budget_status` / `region_budget_status` describe the reservation made **before** Google is called. The older `crawler_progress.region_budget`, `region_budget_used`, and other legacy paid counters are not used as per-region authority.

When a city's or region's frozen monthly allowance is exhausted, the cursor advances to the next city or region rather than blocking unrelated allocations. A finished exhausted region is not due again until the next UTC month. A global monthly or daily limit stops the whole run until its boundary instead.

## Listing writes

Places results provide canonical Place ID, name, address, location, rating, review count, price, Maps URL, and structured cuisine tags where available. New rows copy cuisine tags into `cuisines`; amenities are not inferred from Maps pages or names. Existing listings refresh only when over 60 days old, verified rating changes by over 0.3, review count rises by over 50, or verified provider fields can fill address, cuisine, price, or website. Missing provider values do not clear existing fields. A refresh preserves claim/outreach data, amenity, phone, type, original city/region, coordinates, and Maps URL. Processing only the current Nearby response never schedules another paid fetch.

## Database and deployment

The workspace-connected database has additive migrations through `0024_grid_crawl_runtime.sql`. Production is **not activated by this change**. Before any production run, separately confirm the published API's actual external database target (not merely the development secret), review its existing cursor and ledger and plan the migration of `0017_crawler_progress.sql` through `0024_grid_crawl_runtime.sql` on that verified target. Replit Publish does not migrate a separately connected external database. Obtain approval of the estimated monthly limit before enabling any automatic paid runner. Do not copy a development cursor or paid budget counters into production.

All server-side Google Places searches, Place Details, and Photo Media calls now reserve from the same monthly request ledger before contacting Google. Each request consumes at least 50p of an **estimated** maximum £30 per UTC month, including legacy requests that were recorded at a lower estimate; the limit can be configured lower but not higher. Once exhausted, photos and reviews may be unavailable until the next month. This is an app-side request limit, **not a guaranteed Google invoice cap**: Google Cloud billing budgets are alerts, not hard spending limits, and other keys/projects or price changes are outside this ledger. Configure provider-side quotas and billing alerts separately.