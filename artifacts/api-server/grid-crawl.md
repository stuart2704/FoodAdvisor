# Manual restaurant grid crawl

This crawler is **not scheduled** and does not run with the API server. It cannot recover the original database. It creates new listings using Google Places Nearby Search, which may incur charges. Each point returns up to 10 restaurants, not all restaurants in a city. It stores name, address, city, mapped region/country, actual place coordinates, rating, review count, cuisine tags derived from Places types, price level, canonical Place ID, and Maps URL in the existing table. Missing Places fields stay null or empty rather than being invented.

The additive `lib/db/migrations/0014_restaurant_review_count.sql` column must be present on the database the API uses before starting the updated API or running the confirmed crawl.

The included `coordinates.json` contains only the 20 points provided for London and New York City. It is a partial grid: no other city points have been invented. To expand it, add verified `[latitude, longitude]` pairs:

```json
{
  "europe": {
    "london": [[51.5074, -0.1278]],
    "paris": [[48.8566, 2.3522]]
  },
  "north_america": {
    "new_york": [[40.7128, -74.006]]
  }
}
```

Only cities present in the application's verified region map are accepted. The example above is illustrative, not the missing original grid.

From the project root, first preview the plan without connecting to a database or making an API call:

```bash
pnpm --filter api-server exec tsx src/scripts/gridCrawl.ts --grid coordinates.json --state grid-progress.json --monthly-budget-cents 2500
```

To run intentionally, add `--confirm` to the same command. The state path must be writable and **persistent across runs**; keep the original grid file unchanged. A changed grid or invalid progress fails closed rather than restarting at point zero. The script processes at most 50 attempted points per UTC day, delays 15 seconds between calls, and resumes from the next completed point. Each call reserves a conservative estimated 50 pence in the existing import ledger **before** contacting Google; this is not a guaranteed invoice cap. Use a provider-side quota/budget as well. Failed or uncertain requests stop the run without advancing the point; inspect the result before retrying because retrying could be charged again. Place IDs are deduplicated, and existing restaurant/claim/outreach data is never overwritten. Never commit real credentials or progress files to source control.