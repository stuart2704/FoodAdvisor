---
name: Restaurant event time semantics
description: How to interpret owner-entered event dates and times in calendar exports.
---

Treat restaurant event date and time as a local wall-clock start, not a known UTC instant. Do not invent an event end time or time zone in calendar exports.

**Why:** Owners provide only a date and HH:mm time, without a time zone or duration. Converting using the diner's device zone or server zone would silently move the event; assigning an end would misrepresent its schedule.

**How to apply:** Use a floating calendar start until the owner event data model explicitly includes a verified time zone and end/duration. If that model changes, update exports and existing events together.