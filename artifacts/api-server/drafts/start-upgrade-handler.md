# Start upgrade handler — draft only

Not imported into the app or connected to upgrade buttons. Paid upgrades remain unavailable.

Before activation:
- Confirm the actual backend endpoint and use the web app's API base-path convention.
- Authenticate and authorize the claim using the canonical Google Place ID; do not trust a submitted name or email as proof of ownership.
- Handle network failures, non-success HTTP responses, and invalid JSON without redirecting.
- Validate the returned checkout URL against the approved payment-provider destination.
- Prevent repeated submissions and display a clear pending or error state.

## Original snippet

```javascript
const startUpgrade = async () => {
  const res = await fetch("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurantId,
      restaurantName,
      email
    })
  });

  const data = await res.json();
  window.location.href = data.checkoutUrl;
};
```

## Button snippet — draft only

Keep this disconnected until the handler and paid checkout are ready.

```jsx
<button className="upgrade-button" onClick={startUpgrade}>
  Upgrade for £99/month
</button>
```