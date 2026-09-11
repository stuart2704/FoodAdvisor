---
name: Nearby location policy
description: Budget and accuracy constraints for GPS restaurant discovery
---

Near-me searches must not trigger paid geocoding or Places searches automatically. Do not substitute city centres for missing restaurant coordinates.

**Why:** The existing restaurant collection predated GPS support and lacked coordinates. Automatically backfilling on each user location request risks the fixed import budget, while approximate city coordinates would misrepresent nearby distances.

**How to apply:** Acquire restaurant coordinates through explicitly confirmed budgeted imports or another approved refresh. Show honest limited-coverage states until coordinates are available.