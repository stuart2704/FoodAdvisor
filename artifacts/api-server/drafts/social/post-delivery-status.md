# Proposed post-delivery status — draft only

```javascript
await updateStatus(post.placeId, "social_post_sent");
```

Not connected to the posting engine or cron handler. The existing outreach status adapter does not support `social_post_sent`.

Before implementation, record verified delivery separately for each post and platform, including the provider post ID. A simulated result, empty placeholder function, or accepted request is not proof of publication. Preserve restaurant outreach, onboarding, menu, and subscription state instead of overwriting it with a social delivery status.