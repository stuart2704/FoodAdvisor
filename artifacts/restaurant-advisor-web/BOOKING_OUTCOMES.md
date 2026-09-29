# Booking outcome reporting

**Status (September 2026): confirmation reporting is unavailable.** The approved booking URL is an outbound link; it is not a reservation integration. `booking_now_clicked` is a browser-side website analytics event with a fixed `/booking` path and a Boolean provider-label flag, not a confirmed reservation. Website analytics may be disabled, so it is not an authoritative click denominator. The existing internal `restaurantBookingsTable` measures a different in-app flow and must not be counted as provider confirmations.

Provider assessment (public documentation, not a grant of permission):

| Provider found by the website scraper | Confirmation path | Current permission / attribution |
| --- | --- | --- |
| [OpenTable](https://www.opentable.com/restaurant-solutions/api-partners/faqs/) | Partner APIs exist; the public FAQ describes a Directory API for reservation links, not a confirmation callback for arbitrary outbound links. | Partner application or restaurant account-team coordination required; no partner attribution or authorized confirmation feed configured. |
| [ResDiary](https://help-resdiary.theaccessgroup.com/en/collections/15898115-booking-reports) | Restaurant booking reports exist. | No verified third-party referral confirmation feed or permission to use restaurant reports here. |
| [Quandoo](https://docs.quandoo.com/webhooks-notifications/) | `RESERVATION_CONFIRMED` webhook is documented, but webhooks are merchant/agent-specific and only fire for bookings created with the registered agent ID. | [Partner agreement](https://docs.quandoo.com/quandoo-public-api/) determines access; Quandoo must manually register webhooks. Plain owner links have no agent attribution and no partner permission. |
| [SevenRooms](https://api-docs.sevenrooms.com/) | Reservation integrations exist, but documentation access is provisioned individually. | Partnership and scoped access are required; neither is configured here. |
| [TableAgent](https://tableagent.com/terms) | Restaurant account reporting exists; no public confirmation callback for this site's links was verified. | No authorized third-party confirmation feed here. |
| Owner-entered or unlabelled provider | Arbitrary approved HTTPS URL, potentially outside the five providers above. | No universal callback or permission; confirmation reporting unavailable. |

The owner and admin booking sections report outbound intent and confirmed reservations separately. They show conversion as **unavailable**, not 0%, for every provider without an authorized and attributable confirmation feed. No client-side “booking completed” event, query-string tracking identifier, diner identifier, owner portal token, or destination URL is sent to a provider or analytics as a proxy for completion.

To activate a provider later, first obtain written permission covering attribution and aggregate reporting; ensure the integration can distinguish this site's referrals from other bookings. Verify webhook authentication, idempotency, cancellations, consent and data minimization. Aggregate confirmed counts server-side by provider and reporting period, never store booking details or diner identity in analytics, and only calculate a rate against a comparable, reliable click denominator and attribution window. Do not expose a public confirmation endpoint before these prerequisites exist.