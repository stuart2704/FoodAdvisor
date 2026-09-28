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

These server-side counts do not require publishing or enabling Project Analytics. After the clean portal URL is deployed and website analytics is enabled, successful offer actions also send the three custom event names above to Project Analytics, using fixed `/offers` URL and title metadata (no token, restaurant ID, offer content, or referrer). The browser events supplement, not replace, the authoritative server counters. Booking-link custom events (`booking_link_published`, `booking_link_withdrawn`, `booking_now_clicked`) remain available with fixed `/booking` metadata.

## Safe publishing

The currently published site injects `https://i.replit.com/script.js` with a website ID on owner portal pages. Inspection of that injected tracker showed it derives the automatic pageview URL from the full `location.href`, including path, query and hash; token-free custom event data alone is not enough. Do not test with a real owner token.

The website now runs a synchronous head script **before** the proxy-injected async tracker: it transfers legacy `/portal/<token>/...` links or new `/portal#access=<token>` links into tab-scoped session storage and replaces the browser URL with a clean `/portal/...` path. Navigation between portal sections also uses clean paths. The script removes portal query strings (including checkout return parameters), fragments and malformed legacy access paths before tracking starts. Portal pages set a no-referrer policy. The API still validates the owner token on every request; merely knowing a clean portal path grants no access. Owners can refresh within the same tab, but a clean path opened independently in another tab requires their original access link again. For new shareable access links use `/portal#access=<token>`, **never** `/portal/<token>`; the fragment is also cleared before tracking because the injected tracker does not exclude hashes by default. Previously issued path links remain usable, but may still appear in server/proxy request logs; rotate those links if their server-side exposure is a concern.

**Do not enable website analytics globally yet:** other private claim URLs (`/claim/...` paths and claim token queries) still need the same pageview review and protection. The portal pageview issue is fixed, but the global setting also tracks those routes. Once all credential-bearing website routes are protected, enable analytics in Publishing settings and publish or republish; the offer custom events will then be available. No extra Umami script, website ID or analytics configuration should be added to app code. Keep the synchronous head scrubber in the HTML entrypoint; moving it into the React bundle would let the injected tracker run first. If the publishing proxy changes script placement or tracker URL handling, verify with **synthetic** tokens again before enabling analytics on that revision. The server-side offer counters do not depend on the analytics setting.