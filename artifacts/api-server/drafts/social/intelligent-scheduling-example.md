# Intelligent scheduling example — inactive draft

## Proposed timezone conversion

```javascript
scheduledFor: convertToLocalTime(restaurant.timezone, bestTime)
```

Preserved as supplied; not executed. `convertToLocalTime` still needs an implementation and an explicit posting date. It should resolve the restaurant's local date and time to an unambiguous timestamp, handling daylight-saving transitions and avoiding past times. In the existing example, the time value is `timing.bestTime`.

```javascript
const timing = getBestPostingTime(restaurant);

schedulePost({
  ...post,
  scheduledFor: `${today}T${timing.bestTime}:00`,
  platforms: [timing.bestPlatform]
});
```

Preserved as supplied; not executed or connected to the cron handler.

Before activation:
- Define `today` and resolve the restaurant's timezone explicitly.
- Use `timing.bestDay` to choose the intended date and avoid scheduling in the past.
- Align this single-object call with the existing draft's `schedulePost(restaurant, post)` signature. That draft currently returns a fixed schedule rather than using this supplied time or persisting a post.