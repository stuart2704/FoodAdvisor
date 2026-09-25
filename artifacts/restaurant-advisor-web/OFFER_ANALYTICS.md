# Owner offer outcome counts

Offer outcomes are counted server-side only after the portal API confirms a mutation. No browser analytics event is sent on token-bearing owner portal URLs.

| Event name | Description |
| --- | --- |
| `owner_offer_published` | An offer was created. |
| `owner_offer_updated` | An offer was updated. |
| `owner_offer_deleted` | An offer was deleted. |

The `owner_offer_metrics` table stores only a UTC calendar day, one of the fixed event names above, and a count. It never stores offer text, restaurant IDs, portal tokens, browser URLs, or error messages. Failed or unauthorized requests do not increment success counts. Validation failures are not counted.

To see daily totals after applying the `0031_owner_offer_metrics.sql` migration:

```sql
SELECT day, event, count FROM owner_offer_metrics ORDER BY day DESC, event;
```

These server-side counts do **not** appear in Replit Project Analytics and do not require publishing or enabling its tracker. Replit Project Analytics, if enabled for this website, injects a browser tracker and collects automatic pageviews. Owner portal links still contain bearer tokens in their URL paths, so **do not enable the injected tracker for owner portal traffic** until pageview and event URL metadata are proven to exclude those tokens. Once the tokenized-path issue is resolved, enabling analytics in Publishing settings and publishing or republishing will make future client events available; the server-side counters themselves do not need a publish to begin recording after deployment and database migration.