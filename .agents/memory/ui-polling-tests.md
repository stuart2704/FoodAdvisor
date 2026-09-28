---
name: UI polling tests
description: Prevent test-library timer callbacks from being mistaken for application polling callbacks.
---

When testing React polling with a captured timer callback, filter by the application's delay rather than treating the latest scheduled interval as its poll.

**Why:** Testing Library's asynchronous find/wait helpers schedule their own intervals. A broad timer spy can capture a helper's callback after the application's timer and silently drive the wrong function, leaving the test looking like polling is broken.

**How to apply:** Prefer a delay-filtered interval spy, or install fake timers before the component mounts and handle the helper's timers separately.