---
name: Stripe sandbox reruns
description: Why repeated real checkout journeys can hit a preview-wide rate limit.
---

Real sandbox journeys use fresh restaurant identities, but their checkout requests still share the same preview client IP and rate-limit bucket. Two immediately consecutive full journeys can therefore activate payment successfully yet fail the final "already subscribed" check with HTTP 429 rather than the expected 409.

**Why:** The limit is keyed by network client, not the generated test restaurant, so cleanup does not reset it. A missing Playwright browser can also cause an early test failure before payment even though cleanup succeeds.

**How to apply:** For independent repeat runs, allow the checkout window to expire or restart the development API between runs; do not weaken the production checkout limiter or interpret this 429 as a Stripe connector failure. Ensure the Playwright Chromium binary is installed before running the opt-in journey.